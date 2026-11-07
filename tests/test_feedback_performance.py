"""Behavior and bounded-work checks for feedback reads, sync and verified images."""

import copy
import io
import json
import sqlite3
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from server_app.domains.feedback import files, service, sync
from server_app.domains.feedback import repository as repo
from server_app.domains.feedback.gitea import Client, RemoteError
from server_app.web import feedback as web
from tests.feedback_fixtures import ACTOR, ADMIN, FeedbackFixture, screenshot, submission


class FeedbackPerformanceTests(FeedbackFixture, unittest.TestCase):
    def create(self):
        with self.connect() as conn:
            return service.create(conn, ACTOR, submission())["id"]

    def test_summary_keeps_display_filter_sort_and_actor_fields_without_heavy_values(self):
        identity = self.create()
        with self.connect() as conn:
            conn.execute("INSERT INTO feedback_encounters VALUES(?,?,?)", (identity, ACTOR["id"], "now"))
        for actor in (ACTOR, ADMIN):
            with self.connect() as conn:
                filters = {"keyword": "详细", "sortKey": "author", "sortDir": "asc", "limit": 1}
                full = service.list_page(conn, actor, filters)
                summary = service.list_page(conn, actor, {**filters, "view": "summary"})
                self.assertEqual(full["total"], summary["total"])
                self.assertEqual(
                    summary["items"],
                    [
                        {k: v for k, v in row.items() if k not in {"description", "environment", "importMetadata"}}
                        for row in full["items"]
                    ],
                )
                rows = repo.list_page(conn, actor, {**filters, "view": "summary"}, True)["items"]
                self.assertFalse({"description", "environment", "import_metadata"}.intersection(rows[0].keys()))

    def test_detail_batches_visible_comment_attachments_and_preserves_original_order(self):
        identity = self.create()
        with self.connect() as conn:
            for n in range(40):
                comment_id = f"comment-{n:03}"
                conn.execute(
                    """INSERT INTO feedback_comments(id,feedback_id,body,author,source,created_at,updated_at,visible)
                    VALUES(?,?,?,?,'local','same','same',?)""",
                    (comment_id, identity, str(n), "{}", int(n != 39)),
                )
                for a in range(3):
                    asset_id = f"asset-{n}-{a}"
                    conn.execute(
                        """INSERT INTO feedback_attachments(id,feedback_id,comment_id,actor_id,request_id,request_hash,
                        name,mime,size,storage_name,created_at,visible) VALUES(?,?,?,'actor',?,'hash',?,'image/png',1,'x','same',?)""",
                        (asset_id, identity, comment_id, asset_id, asset_id, int(a != 1)),
                    )
        with self.connect() as conn:
            queries = []
            conn.set_trace_callback(queries.append)
            result = service.detail(conn, ACTOR, identity)
            self.assertEqual(len(result["comments"]), 39)
            for n, comment in enumerate(result["comments"]):
                self.assertEqual(comment["id"], f"comment-{n:03}")
                self.assertEqual([a["id"] for a in comment["attachments"]], [f"asset-{n}-0", f"asset-{n}-2"])
            selects = [q for q in queries if q.lstrip().startswith("SELECT") and "FROM feedback_attachments" in q]
            self.assertEqual(len(selects), 1)
            plan = [row[3] for row in conn.execute("EXPLAIN QUERY PLAN " + selects[0])]
            self.assertTrue(
                any("SEARCH feedback_attachments USING INDEX feedback_attachments_parent" in row for row in plan), plan
            )

    def remote(self):
        return {
            "issue": {"state": "open", "labels": []},
            "assets": [],
            "comments": [
                {
                    "id": n + 1,
                    "body": f"body-{n}",
                    "updated_at": "same",
                    "created_at": "same",
                    "user": {"login": "dev"},
                    "assets": [{"id": a + 1, "name": f"{a}.png", "size": 8} for a in range(3)],
                }
                for n in range(30)
            ],
        }

    def test_unchanged_sync_does_not_rewrite_comments_assets_or_audit_and_restores_changes(self):
        identity = self.create()
        remote = self.remote()
        with self.connect() as conn:
            sync.project_remote(conn, repo.get(conn, identity), remote)
        with self.connect() as conn:
            before = sync._projection(conn, identity)
            version = repo.get(conn, identity)["version"]
            audits = conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0]
            queries = []
            conn.set_trace_callback(queries.append)
            changes = conn.total_changes
            self.assertFalse(sync.apply(conn, {"kind": "refresh"}, repo.get(conn, identity), remote))
            self.assertEqual(conn.total_changes - changes, 1)
            self.assertEqual(repo.get(conn, identity)["version"], version + 1)
            self.assertEqual(sync._projection(conn, identity), before)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0], audits)
            self.assertFalse(
                any(q.startswith(("UPDATE feedback_comments", "UPDATE feedback_attachments")) for q in queries)
            )
            changed = copy.deepcopy(remote)
            changed["comments"][0]["body"] = "edited"
            changed["comments"][1]["assets"] = []
            changed["comments"].pop()
            self.assertTrue(sync.apply(conn, {"kind": "refresh"}, repo.get(conn, identity), changed))
            self.assertEqual(
                conn.execute("SELECT body,remote_body FROM feedback_comments WHERE remote_id=1").fetchone()[:],
                ("body-0", "edited"),
            )
            self.assertEqual(conn.execute("SELECT visible FROM feedback_comments WHERE remote_id=30").fetchone()[0], 0)
            self.assertTrue(sync.apply(conn, {"kind": "refresh"}, repo.get(conn, identity), remote))
            self.assertEqual(sync._projection(conn, identity), before)

    def test_repeated_remote_comment_ids_do_not_duplicate_assets_and_keep_last_visible_set(self):
        identity = self.create()
        item = self.remote()["comments"][0]
        remote = {"issue": {"state": "open", "labels": []}, "comments": [item, copy.deepcopy(item)], "assets": []}
        with self.connect() as conn:
            sync.project_remote(conn, repo.get(conn, identity), remote)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM feedback_comments").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM feedback_attachments").fetchone()[0], 3)
            remote["comments"][0]["body"] = "intermediate edit"
            remote["comments"][1]["assets"] = []
            sync.project_remote(conn, repo.get(conn, identity), remote)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM feedback_attachments WHERE visible=1").fetchone()[0], 0)
            self.assertEqual(
                conn.execute("SELECT COALESCE(remote_body,body) FROM feedback_comments").fetchone()[0],
                remote["comments"][1]["body"],
            )

    def test_stale_queue_later_batch_failure_rolls_back_the_entire_caller_transaction(self):
        with self.connect() as conn:
            for n in range(205):
                conn.execute(
                    """INSERT INTO feedback(id,actor_id,request_id,request_hash,title,kind,module,description,
                    author,environment,created_at,updated_at,repository,issue_number) VALUES(?, 'actor',?,'hash','t','bug','m','d','{}','{}','a','a','repo',1)""",
                    (str(n), str(n)),
                )
        with self.assertRaisesRegex(sqlite3.OperationalError, "second batch"):
            with self.connect() as conn:

                class Failing:
                    count = 0

                    def __getattr__(self, name):
                        return getattr(conn, name)

                    def execute(self, sql, params=()):
                        if sql.startswith("WITH due"):
                            self.count += 1
                            self_test.assertTrue(conn.in_transaction)
                            if self.count == 2:
                                raise sqlite3.OperationalError("second batch")
                        return conn.execute(sql, params)

                self_test = self
                repo.queue_stale(Failing(), age=-1)
        with self.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM feedback_tasks").fetchone()[0], 0)


class FeedbackConditionalHttpTests(FeedbackFixture, unittest.TestCase):
    def test_actor_visibility_and_deletion_precede_conditional_detail_response(self):
        with self.connect() as conn:
            identity = service.create(conn, ACTOR, submission())["id"]
            conn.execute("INSERT INTO feedback_encounters VALUES(?,?,?)", (identity, ACTOR["id"], "now"))

        class Handler:
            path = "/api/feedback/" + identity
            headers = {}
            user = ACTOR
            payload = None
            response_headers = {}

            def require_user(self):
                if self.user:
                    return self.user
                self.send_json({"error": "login"}, 401)

            def send_json(self, payload, status=200, extra_headers=None):
                self.payload = payload
                self.status = status
                self.response_headers = extra_headers or {}

            def send_response(self, status):
                self.status = status
                self.payload = None

            def send_header(self, name, value):
                self.response_headers[name] = value

            def end_headers(self):
                pass

        handler = Handler()
        with patch.object(web, "connect_db", self.connect):
            web.handle(handler, "GET", handler.path)
            etag = handler.response_headers["ETag"]
            handler.headers = {"If-None-Match": etag}
            web.handle(handler, "GET", handler.path)
            self.assertEqual(handler.status, 304)
            self.assertIsNone(handler.payload)
            handler.user = {**ACTOR, "id": "another"}
            web.handle(handler, "GET", handler.path)
            self.assertEqual(handler.status, 200)
            self.assertFalse(handler.payload["item"]["encountered"])
            with self.connect() as conn:
                conn.execute("UPDATE feedback SET status='deleted'")
            handler.headers = {"If-None-Match": "*"}
            web.handle(handler, "GET", handler.path)
            self.assertEqual(handler.status, 404)
            handler.user = None
            web.handle(handler, "GET", handler.path)
            self.assertEqual(handler.status, 401)


class FeedbackImageCacheTests(FeedbackFixture, unittest.TestCase):
    def test_images_revalidate_visibility_and_identity_then_reuse_only_verified_bytes(self):
        with self.connect() as conn:
            identity = service.create(conn, ACTOR, submission())["id"]
            conn.execute("UPDATE feedback SET issue_number=1")
            conn.execute(
                """INSERT INTO feedback_attachments(id,feedback_id,actor_id,request_id,request_hash,name,mime,
                size,storage_name,remote_id,source,created_at) VALUES('asset',?,'','asset','hash','x.png','image/png',0,'',7,'gitea','now')""",
                (identity,),
            )
        image = screenshot()
        etag = '"one"'
        calls = []
        internal = False
        advertise = True
        asset_url = self.client.repository.split("/hugo/")[0] + "/attachments/image"
        during_download = None

        def opened(request, timeout):
            self.assertEqual(timeout, 10)
            calls.append((request.full_url, request.get_header("If-none-match")))
            if request.full_url.endswith("/issues/1"):
                body = json.dumps({"body": "【内部】hidden" if internal else "public"}).encode()
            elif "/assets/7" in request.full_url:
                body = json.dumps({"id": 7, "browser_download_url": asset_url}).encode()
            else:
                if during_download:
                    during_download()
                if advertise and request.get_header("If-none-match") == etag:
                    raise HTTPError(request.full_url, 304, "unchanged", {"ETag": etag}, None)
                response = io.BytesIO(image)
                response.headers = {"ETag": etag} if advertise else {}
                return response
            response = io.BytesIO(body)
            response.headers = {}
            return response

        def client(*args):
            value = Client(*args)
            value.opener.open = opened
            return value

        bodies = []

        class Handler:
            def send_download(self, body, *args):
                bodies.append(body)

        with (
            patch.multiple(
                web,
                CAGELEDGER_REPOSITORY_URL=self.client.repository,
                CAGELEDGER_GITEA_TOKEN="mock-token",
                FEEDBACK_FILES_PATH=self.root,
            ),
            patch.object(web, "connect_db", self.connect),
            patch.object(web, "Client", side_effect=client),
            patch.object(files, "validate", wraps=files.validate) as validate,
            patch.object(files, "store", wraps=files.store) as store,
        ):
            web.download(Handler(), "asset")
            web.download(Handler(), "asset")
            self.assertEqual(validate.call_count, 1)
            self.assertEqual(store.call_count, 1)
            self.assertEqual(bodies, [image, image])
            self.assertEqual(calls[-1][1], etag)
            with self.connect() as conn:
                storage = conn.execute("SELECT storage_name FROM feedback_attachments WHERE id='asset'").fetchone()[0]
            (self.root / storage).write_bytes(b"corrupt")
            web.download(Handler(), "asset")
            self.assertIsNone(calls[-1][1])
            self.assertEqual(validate.call_count, 2)
            advertise = False
            web.download(Handler(), "asset")
            web.download(Handler(), "asset")
            self.assertEqual(validate.call_count, 2)
            self.assertEqual(store.call_count, 2)
            asset_url += "-new-identity"
            web.download(Handler(), "asset")
            self.assertIsNone(calls[-1][1])
            self.assertEqual(validate.call_count, 3)
            self.assertEqual(store.call_count, 3)
            valid_url = asset_url
            asset_url = "https://other.invalid/attachments/image"
            before = len(bodies)
            with self.assertRaises(RemoteError):
                web.download(Handler(), "asset")
            self.assertEqual(len(bodies), before)
            asset_url = valid_url

            def remove_parent():
                with self.connect() as conn:
                    conn.execute("UPDATE feedback SET status='deleted'")

            during_download = remove_parent
            with self.assertRaises(LookupError):
                web.download(Handler(), "asset")
            self.assertEqual(len(bodies), before)
            during_download = None
            with self.connect() as conn:
                conn.execute("UPDATE feedback SET status='pending'")
            internal = True
            before = len(bodies)
            with self.assertRaises(LookupError):
                web.download(Handler(), "asset")
            self.assertEqual(len(bodies), before)
            with self.connect() as conn:
                with self.assertRaises(LookupError):
                    files.accessible(conn, "asset")
