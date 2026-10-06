"""Historical import with isolated SQLite and a read-only mock remote."""

import copy
import sqlite3
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from server_app.domains.feedback import importer, service, sync
from server_app.domains.feedback import repository as repo
from server_app.domains.feedback.gitea import RemoteError
from server_app.web import feedback as web
from tests import test_feedback as fixtures


def issue(number=7, **overrides):
    return {
        "number": number,
        "title": "[笼位管理] 选择提示",
        "body": "## 反馈信息\n\n- 提出人：张三\n- 类型：功能建议\n- 涉及模块：笼位管理\n\n原始需求",
        "state": "closed",
        "labels": [{"name": "反馈/已解决"}, {"name": "功能建议"}],
        "user": {"id": 1, "login": "owner"},
        "created_at": "2025-09-03T00:00:00Z",
        "updated_at": "2025-10-03T00:00:00Z",
        "milestone": {"title": "1.2.0"},
        "assignees": [{"login": "developer"}],
        **overrides,
    }


class ImportRemote(fixtures.FakeGitea):
    barrier = None
    inspect = None

    def request(self, method, path, body=None):
        if self.inspect:
            self.inspect()
        if method == "GET" and path.startswith("/issues?"):
            self.calls.append((method, path, body))
            query = parse_qs(urlparse(path).query)
            state = query["state"][0]
            rows = [row for row in self.issues if state == "all" or row["state"] == state]
            start = (int(query["page"][0]) - 1) * 20
            return copy.deepcopy(rows[start : start + 20])
        result = super().request(method, path, body)
        if self.barrier and path.startswith("/issues/") and path.count("/") == 2:
            self.barrier.wait(timeout=5)
        return result

    def pages(self, path):
        if self.inspect:
            self.inspect()
        return super().pages(path)


class FeedbackImportTests(unittest.TestCase):
    tearDown = fixtures.FeedbackTests.tearDown
    connect = fixtures.FeedbackTests.connect
    run_worker = fixtures.FeedbackTests.run_worker

    def setUp(self):
        fixtures.FeedbackTests.setUp(self)
        self.client = ImportRemote()
        self.client.issues = [issue()]
        self.patch_client = patch.object(importer, "Client", return_value=self.client)
        self.patch_client.start()
        self.addCleanup(self.patch_client.stop)

    def submit(self, numbers=None, request_id=None):
        with self.connect() as conn:
            return importer.import_selected(
                conn,
                fixtures.ADMIN,
                {"numbers": numbers or [7], "repository": fixtures.REPOSITORY, "requestId": request_id or str(uuid4())},
            )

    def test_preview_is_admin_only_paginated_and_preserves_reporter(self):
        self.client.issues = [issue(number) for number in range(1, 23)]
        with self.connect() as conn:
            with self.assertRaises(PermissionError):
                importer.preview(conn, fixtures.ACTOR, {})
            self.assertEqual(self.client.calls, [])
            page = importer.preview(conn, fixtures.ADMIN, {"page": "1", "state": "closed"})
            self.assertEqual(len(page["items"]), 20)
            self.assertTrue(page["hasMore"])
            self.assertEqual(page["items"][0]["reporter"], "张三")
            self.assertEqual(page["items"][0]["status"], "resolved")
            last = importer.preview(conn, fixtures.ADMIN, {"page": "2"})
            self.assertEqual([item["number"] for item in last["items"]], [21, 22])
            self.assertFalse(last["hasMore"])
            with patch.object(service, "CAGELEDGER_GITEA_TOKEN", ""), self.assertRaises(ValueError):
                importer.preview(conn, fixtures.ADMIN, {})

    def test_old_title_reporter_and_fallback_do_not_impersonate_admin(self):
        old = importer.summary(issue(title="优化菜单 @李四", body="说明"))
        self.assertEqual(old["reporter"], "李四")
        self.assertEqual(old["reporterSource"], "record")
        fallback = importer.summary(issue(body="说明", labels=[{"name": "故障"}, {"name": "功能建议"}]))
        self.assertEqual(fallback["reporter"], "owner")
        self.assertEqual(fallback["reporterSource"], "gitea")
        self.assertEqual(fallback["kind"], "bug")

    def test_import_snapshots_comments_attachments_state_and_audit_without_remote_writes(self):
        self.client.comments = [
            {"id": 5, "body": "已完成", "user": {"login": "developer"}, "created_at": "2025-10-01T00:00:00Z"},
            {"id": 6, "body": " \n【内部】秘密", "user": {"login": "developer"}},
        ]
        self.client.assets = {
            "/issues/7/assets": [{"id": 1, "name": "original.png", "size": 32}],
            "/issues/comments/5/assets": [{"id": 2, "name": "reply.jpg", "size": 32}],
        }
        result = self.submit()["items"][0]
        self.assertEqual(result["outcome"], "imported")
        with self.connect() as conn:
            detail = service.detail(conn, fixtures.ACTOR, result["feedbackId"])
            item = detail["item"]
            self.assertEqual(item["createdBy"]["name"], "张三")
            self.assertNotEqual(item["createdBy"]["id"], fixtures.ADMIN["id"])
            self.assertEqual(item["createdAt"], "2025-09-03T00:00:00+00:00")
            self.assertEqual(item["description"], self.client.issues[0]["body"])
            self.assertEqual(
                (item["status"], item["fixVersion"], item["assignees"]), ("resolved", "1.2.0", ["developer"])
            )
            self.assertEqual(item["source"], "gitea")
            self.assertEqual(item["importMetadata"]["importedBy"]["id"], fixtures.ADMIN["id"])
            self.assertEqual([entry["body"] for entry in detail["comments"]], ["已完成"])
            self.assertEqual(detail["attachments"][0]["name"], "original.png")
            self.assertEqual(detail["comments"][0]["attachments"][0]["name"], "reply.jpg")
            audit = conn.execute(
                "SELECT actor_user_id,action FROM audit_events WHERE action='feedback.imported'"
            ).fetchone()
            self.assertEqual(tuple(audit), (fixtures.ADMIN["id"], "feedback.imported"))
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM feedback_tasks").fetchone()[0], 0)
        self.assertFalse(any(call[0] != "GET" for call in self.client.calls))
        self.assertNotIn(("GET", "/issues/comments/6/assets", None), self.client.calls)

    def test_retry_and_parallel_requests_never_duplicate_or_resurrect(self):
        request_id = str(uuid4())
        first = self.submit(request_id=request_id)
        calls = len(self.client.calls)
        self.assertEqual(first, self.submit(request_id=request_id))
        self.assertEqual(calls, len(self.client.calls))
        self.assertEqual(self.submit()["items"][0]["outcome"], "skipped")
        with self.connect() as conn:
            conn.execute("UPDATE feedback SET status='deleted'")
        self.assertEqual(self.submit()["items"][0]["outcome"], "skipped")
        with self.connect() as conn:
            preview = importer.preview(conn, fixtures.ADMIN, {})
            self.assertFalse(preview["items"][0]["importable"])
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0], 1)

    def test_concurrent_administrators_create_one_association(self):
        self.client.barrier = threading.Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.submit(), range(2)))
        self.assertEqual(sorted(item["items"][0]["outcome"] for item in results), ["imported", "skipped"])
        with self.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0], 1)

    def test_partial_failures_invalid_ranges_and_internal_issues(self):
        self.client.issues.extend(
            [
                issue(8, body="【内部】不可公开"),
                issue(9, pull_request={}),
                issue(10, body=sync.marker("feedback", "existing")),
            ]
        )
        results = self.submit([7, 8, 9, 10, 999])["items"]
        self.assertEqual([item["outcome"] for item in results], ["imported", "skipped", "skipped", "skipped", "failed"])
        with self.connect() as conn:
            for numbers in ([True], [0], [7, 7], list(range(1, 12))):
                with self.assertRaises(ValueError):
                    importer.import_selected(
                        conn,
                        fixtures.ADMIN,
                        {"requestId": str(uuid4()), "repository": fixtures.REPOSITORY, "numbers": numbers},
                    )
            with self.assertRaises(PermissionError):
                importer.import_selected(conn, fixtures.ACTOR, {})
            with self.assertRaises(ValueError):
                importer.import_selected(
                    conn,
                    fixtures.ADMIN,
                    {"requestId": str(uuid4()), "repository": "https://different.test/owner/repo", "numbers": [7]},
                )

    def test_request_id_mismatch_and_repeated_migration_preserve_snapshots(self):
        identity = str(uuid4())
        self.submit(request_id=identity)
        with self.connect() as conn:
            with self.assertRaises(ValueError):
                importer.import_selected(
                    conn, fixtures.ADMIN, {"requestId": identity, "repository": fixtures.REPOSITORY, "numbers": [8]}
                )
            repo.ensure_schema(conn)
            repo.ensure_schema(conn)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT source FROM feedback").fetchone()[0], "gitea")

    def test_network_reads_never_hold_write_transaction_and_refresh_keeps_snapshot(self):
        with self.connect() as conn:
            self.client.inspect = lambda: self.assertFalse(conn.in_transaction)
            item = importer.import_selected(
                conn, fixtures.ADMIN, {"requestId": str(uuid4()), "repository": fixtures.REPOSITORY, "numbers": [7]}
            )["items"][0]
            self.client.inspect = None
            feedback = repo.get(conn, item["feedbackId"])
            self.client.issues[0].update(body="远端编辑正文", state="open", labels=[{"name": "反馈/处理中"}])
            remote = sync.read_remote(self.client, feedback)
            sync.project_remote(conn, feedback, remote)
            updated = service.detail(conn, fixtures.ACTOR, feedback["id"])
            self.assertEqual(updated["item"]["description"], feedback["description"])
            self.assertEqual(updated["item"]["status"], "in_progress")

    def test_http_dispatch_permissions_and_request_routes(self):
        class Handler:
            def read_json_body(self):
                return {"requestId": str(uuid4()), "repository": fixtures.REPOSITORY, "numbers": [7]}

        with self.connect() as conn:
            with self.assertRaises(PermissionError):
                web.dispatch(Handler(), conn, fixtures.ACTOR, "GET", ["import", "preview"], {})
            with self.assertRaises(PermissionError):
                web.dispatch(Handler(), conn, fixtures.ACTOR, "POST", ["import"], {})
            self.assertEqual(
                web.dispatch(Handler(), conn, fixtures.ADMIN, "GET", ["import", "preview"], {})["items"][0]["number"], 7
            )
            self.assertEqual(
                web.dispatch(Handler(), conn, fixtures.ADMIN, "POST", ["import"], {})["items"][0]["outcome"], "imported"
            )

    def test_auth_failure_stops_the_batch_and_a_new_request_can_retry(self):
        calls = []

        def denied(method, path, body=None):
            calls.append(path)
            self.client.auth_blocked = True
            raise RemoteError("权限不足", permanent=True)

        with patch.object(self.client, "request", side_effect=denied):
            result = self.submit([7, 8])["items"]
        self.assertEqual(len(calls), 1)
        self.assertEqual([item["outcome"] for item in result], ["failed", "failed"])
        with self.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0], 0)
        self.client.auth_blocked = False
        self.assertEqual(self.submit()["items"][0]["outcome"], "imported")

    def test_imported_feedback_supplement_vote_progress_and_deletion_share_original_issue(self):
        feedback_id = self.submit()["items"][0]["feedbackId"]
        with self.connect() as conn:
            service.supplement(conn, fixtures.ACTOR, feedback_id, {"requestId": str(uuid4()), "body": "同事补充"})
        with self.connect() as conn:
            service.encounter(conn, fixtures.ACTOR, feedback_id, {"encountered": True})
        self.run_worker()
        self.assertEqual(len(self.client.issues), 1)
        self.assertNotIn(("POST", "/issues"), [(call[0], call[1]) for call in self.client.calls])
        self.assertTrue(any("同事补充" in entry["body"] for entry in self.client.comments))
        self.client.issues[0].update(state="open", labels=[{"name": "反馈/处理中"}])
        with self.connect() as conn:
            repo.enqueue(conn, feedback_id, "refresh")
        self.run_worker()
        with self.connect() as conn:
            self.assertEqual(service.detail(conn, fixtures.ACTOR, feedback_id)["item"]["status"], "in_progress")
            self.assertEqual(service.detail(conn, fixtures.ACTOR, feedback_id)["item"]["encounterCount"], 1)
        self.client.issues.clear()
        with self.connect() as conn:
            repo.enqueue(conn, feedback_id, "refresh")
        self.run_worker()
        with self.connect() as conn:
            with self.assertRaises(LookupError):
                service.detail(conn, fixtures.ACTOR, feedback_id)

    def test_old_schema_backfill_and_restore_keep_existing_association(self):
        with self.connect() as conn:
            item = service.create(conn, fixtures.ACTOR, fixtures.submission())
            conn.execute("ALTER TABLE feedback DROP COLUMN source")
            conn.execute("ALTER TABLE feedback DROP COLUMN import_metadata")
            repo.ensure_schema(conn)
            original = repo.get(conn, item["id"])
            self.assertEqual(original["source"], "local")
            self.assertEqual(original["import_metadata"], "{}")
        imported = self.submit()["items"][0]
        with self.connect() as conn:
            dump = "\n".join(conn.iterdump())
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            conn.executescript(dump)
            repo.ensure_schema(conn)
            self.assertEqual(repo.linked_issue(conn, fixtures.REPOSITORY, 7)["id"], imported["feedbackId"])
            self.assertEqual(
                importer.import_selected(
                    conn, fixtures.ADMIN, {"requestId": str(uuid4()), "repository": fixtures.REPOSITORY, "numbers": [7]}
                )["items"][0]["outcome"],
                "skipped",
            )
