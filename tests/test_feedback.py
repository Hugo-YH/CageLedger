import copy
import io
import json
import shutil
import sqlite3
import ssl
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch
from urllib.error import HTTPError, URLError
from uuid import uuid4

from PIL import Image

from server_app.domains.administration import system
from server_app.domains.feedback import files, service, sync, worker
from server_app.domains.feedback import repository as repo
from server_app.domains.feedback.gitea import Client, ConnectionSetupError, RemoteError
from server_app.shared.sqlite import ClosingConnection
from server_app.web import feedback as web

REPOSITORY = "http://127.0.0.1:7777/hugo/cageledger"
ACTOR = {"id": "colleague", "username": "tester", "displayName": "测试同事", "role": "room_admin"}
ADMIN = {**ACTOR, "id": "admin", "role": "admin"}


def screenshot():
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(output, format="PNG")
    return output.getvalue()


def submission(**values):
    return {
        "requestId": str(uuid4()),
        "title": "反馈测试",
        "kind": "bug",
        "module": "笼卡管理",
        "description": "详细描述",
        "environment": {"appVersion": "1.5.0", "build": "210", "page": "intake-entry", "browser": "Test Browser"},
        **values,
    }


class FakeGitea:
    def __init__(self):
        self.repository = REPOSITORY
        self.auth_blocked = False
        self.issues = []
        self.comments = []
        self.assets = {}
        self.calls = []
        self.fail = None
        self.after_post = None

    def request(self, method, path, body=None):
        self.calls.append((method, path, body))
        if self.fail:
            error = self.fail
            self.fail = None
            raise error
        if method == "POST" and path == "/issues":
            item = {
                "number": len(self.issues) + 1,
                "html_url": REPOSITORY + "/issues/1",
                "state": "open",
                "labels": [],
                **body,
            }
            self.issues.append(item)
        elif method == "POST" and path.endswith("/comments"):
            if not any(issue["number"] == int(path.split("/")[2]) for issue in self.issues):
                raise RemoteError("工单不存在", permanent=True, http_status=404)
            item = {
                "id": len(self.comments) + 1,
                "user": {"login": "developer"},
                "created_at": "2026-10-06T00:00:00Z",
                "updated_at": "2026-10-06T00:00:00Z",
                **body,
            }
            self.comments.append(item)
        elif method == "PATCH":
            item = next(value for value in self.comments if value["id"] == int(path.split("/")[-1]))
            item.update(body)
        elif method == "GET" and path.startswith("/issues/comments/"):
            item = next(value for value in self.comments if value["id"] == int(path.split("/")[-1]))
        elif method == "GET" and path == "":
            item = {"full_name": "hugo/cageledger", "has_issues": True}
        elif method == "GET":
            item = next((issue for issue in self.issues if issue["number"] == int(path.split("/")[-1])), None)
            if not item:
                raise RemoteError("工单不存在", permanent=True, http_status=404)
        else:
            raise AssertionError((method, path))
        if method == "POST" and self.after_post:
            callback = self.after_post
            self.after_post = None
            callback()
        return copy.deepcopy(item)

    def pages(self, path):
        self.calls.append(("GET", path, None))
        if path.endswith("/assets"):
            return copy.deepcopy(self.assets.get(path, []))
        return copy.deepcopy(self.comments if path.endswith("/comments") else self.issues)

    def upload(self, path, filename, content, mime):
        item = {"id": len(self.assets.get(path, [])) + 1, "name": filename, "size": len(content)}
        self.assets.setdefault(path, []).append(item)
        if self.after_post:
            callback = self.after_post
            self.after_post = None
            callback()
        return item


class FeedbackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = self.root / "feedback.sqlite"
        with self.connect() as conn:
            repo.ensure_schema(conn)
            conn.execute("""CREATE TABLE audit_events(id TEXT PRIMARY KEY,actor_user_id TEXT,actor_username TEXT,
                actor_display_name TEXT,action TEXT,entity_type TEXT,entity_id TEXT,message TEXT,slot_ids TEXT,at TEXT,payload TEXT)""")
        self.config = patch.multiple(service, CAGELEDGER_REPOSITORY_URL=REPOSITORY, CAGELEDGER_GITEA_TOKEN="mock-token")
        self.config.start()
        self.client = FakeGitea()

    def tearDown(self):
        self.config.stop()
        self.tmp.cleanup()

    def connect(self):
        conn = sqlite3.connect(self.db, factory=ClosingConnection)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def create(self, body=None, actor=ACTOR):
        with self.connect() as conn:
            return service.create(conn, actor, body or submission())

    def run_worker(self):
        for _ in range(20):
            if not worker.run_once(self.connect, self.client, self.root):
                return
        self.fail("worker failed to drain bounded mock outbox")

    def make_due(self):
        with self.connect() as conn:
            conn.execute("UPDATE feedback_tasks SET due_at=0 WHERE state='pending'")

    def detail(self, feedback_id):
        with self.connect() as conn:
            return service.detail(conn, ACTOR, feedback_id)

    def refresh(self, feedback_id):
        with self.connect() as conn:
            repo.enqueue(conn, feedback_id, "refresh")
        self.run_worker()

    def test_idempotent_submission_and_conflicting_payload(self):
        body = submission()
        first = self.create(body)
        self.assertEqual(self.create(body)["id"], first["id"])
        with self.assertRaises(ValueError):
            self.create({**body, "title": "另一个标题"})
        with self.connect() as conn:
            repo.ensure_schema(conn)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0], 1)

    def test_concurrent_duplicate_submission_creates_one_row(self):
        body = submission()
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.create(body), range(8)))
        self.assertEqual(len({item["id"] for item in results}), 1)

    def test_pagination_filters_and_everyone_can_view(self):
        for title in ("需要帮助", "%特殊_文本", "建议功能"):
            self.create(submission(title=title))
        with self.connect() as conn:
            page = service.list_page(conn, ADMIN, {"limit": "1", "offset": "1"})
            self.assertEqual(page["total"], 3)
            self.assertEqual(len(page["items"]), 1)
            self.assertEqual(service.list_page(conn, ADMIN, {"mine": "1"})["total"], 0)
            self.assertEqual(service.list_page(conn, ACTOR, {"keyword": "%特殊_"})["total"], 1)

    def test_header_filters_cover_all_pages_and_exclude_own_column(self):
        first = self.create(submission(title="早期反馈", module="巡检", kind="bug"))
        second = self.create(submission(title="近期反馈", module="巡检", kind="question"), ADMIN)
        self.create(submission(title="其他模块", module="结算", kind="suggestion"))
        removed = self.create(submission(title="已删除", module="删除专用"))
        with self.connect() as conn:
            conn.execute("UPDATE feedback SET status='deleted' WHERE id=?", (removed["id"],))
            params = {
                "columnFilters": json.dumps({"module": ["巡检"], "kind": ["bug", "question"]}),
                "limit": "1",
                "offset": "1",
                "sortKey": "number",
                "sortDir": "asc",
            }
            page = service.list_page(conn, ACTOR, params)
            self.assertEqual(page["total"], 2)
            self.assertEqual(page["items"][0]["id"], second["id"])
            options = service.filter_options(conn, ACTOR, {**params, "column": "module"})["items"]
            self.assertEqual(options, [{"value": "巡检", "label": "巡检", "count": 2}])
            options = service.filter_options(conn, ACTOR, {"column": "module"})["items"]
            self.assertEqual({row["value"] for row in options}, {"巡检", "结算"})
            params["columnFilters"] = json.dumps({"module": ["巡检"], "author": [ACTOR["id"]]})
            self.assertEqual(service.list_page(conn, ACTOR, params)["total"], 1)
            params["offset"] = "0"
            self.assertEqual(service.list_page(conn, ACTOR, params)["items"][0]["id"], first["id"])
            authors = service.filter_options(conn, ACTOR, {**params, "column": "author"})["items"]
            self.assertEqual({row["value"] for row in authors}, {ACTOR["id"], ADMIN["id"]})

    def test_header_sync_filter_matches_presented_state(self):
        item = self.create()
        with self.connect() as conn:
            for state, error, uncertain in [
                ("pending", "", 0),
                ("working", "", 0),
                ("pending", "断网", 0),
                ("blocked", "无权限", 0),
                ("blocked", "待核对", 1),
                ("done", "旧错误", 1),
            ]:
                conn.execute(
                    "UPDATE feedback_tasks SET state=?,error=?,uncertain=? WHERE feedback_id=?",
                    (state, error, uncertain, item["id"]),
                )
                for configured in (True, False):
                    with patch.object(service, "CAGELEDGER_GITEA_TOKEN", "mock-token" if configured else ""):
                        expected = repo.sync_state(conn, item["id"], configured)[0]
                        options = service.filter_options(conn, ACTOR, {"column": "syncStatus"})["items"]
                        self.assertEqual(options[0]["value"], expected)
                        page = service.list_page(conn, ACTOR, {"columnFilters": json.dumps({"syncStatus": [expected]})})
                        self.assertEqual(page["items"][0]["syncStatus"], expected)
            conn.commit()
            service.encounter(conn, ADMIN, item["id"], {"encountered": True})
            self.assertEqual(
                service.filter_options(conn, ACTOR, {"column": "encounterCount"})["items"][0]["value"], "1"
            )

    def test_header_filter_and_sort_reject_invalid_input(self):
        self.create()
        with self.connect() as conn:
            for filters in [
                "[]",
                "invalid",
                json.dumps({"unknown": []}),
                json.dumps({"module": "巡检"}),
                json.dumps({"module": [1]}),
                json.dumps({"module": ["巡检"] * 101}),
            ]:
                with self.assertRaises(ValueError):
                    service.list_page(conn, ACTOR, {"columnFilters": filters})
            for params in [{"sortKey": "number;DROP TABLE feedback"}, {"sortDir": "invalid"}]:
                with self.assertRaises(ValueError):
                    service.list_page(conn, ACTOR, params)
            with self.assertRaises(ValueError):
                service.filter_options(conn, ACTOR, {"column": "invalid"})
            page = service.list_page(conn, ACTOR, {"columnFilters": json.dumps({"title": ["' OR 1=1 --"]})})
            self.assertEqual(page["total"], 0)

    def test_list_metadata_matches_detail_projection_and_preserves_task_precedence(self):
        items = [self.create(submission(title=f"混合同步状态 {index}")) for index in range(8)]
        with self.connect() as conn:
            for index, item in enumerate(items):
                conn.execute("DELETE FROM feedback_tasks WHERE feedback_id=?", (item["id"],))
                states = [
                    [],
                    [("done", "旧错误", 1)],
                    [("pending", "", 0)],
                    [("working", "", 0), ("pending", "稍后错误", 0)],
                    [("pending", "先前错误", 0), ("blocked", "无权限", 0)],
                    [("blocked", "先核对", 1), ("blocked", "后错误", 0)],
                    [("blocked", "先错误", 0), ("blocked", "后核对", 1)],
                    [("done", "旧错误", 1), ("working", "", 0)],
                ][index]
                for ordinal, (state, error, uncertain) in enumerate(states):
                    conn.execute(
                        "INSERT INTO feedback_tasks(feedback_id,kind,entity_id,state,error,uncertain) VALUES(?,?,?,?,?,?)",
                        (item["id"], f"task-{ordinal}", item["id"], state, error, uncertain),
                    )
                for actor in [ACTOR, ADMIN][: index % 3]:
                    conn.execute("INSERT INTO feedback_encounters VALUES(?,?,?)", (item["id"], actor["id"], "test"))
            conn.commit()
            configured_states = ["synced", "synced", "pending", "error", "error", "uncertain", "error", "pending"]
            configured_errors = ["", "", "", "稍后错误", "无权限", "先核对", "先错误", ""]
            for configured in (True, False):
                with patch.object(service, "CAGELEDGER_GITEA_TOKEN", "mock-token" if configured else ""):
                    for user in (ACTOR, ADMIN, {**ACTOR, "id": "unrelated"}):
                        expected = [
                            service.present(conn, row, user)
                            for row in repo.list_page(conn, user, {}, configured)["items"]
                        ]
                        changes = conn.total_changes
                        for _ in range(2):
                            page = service.list_page(conn, user, {})
                            self.assertEqual(page["items"], expected)
                            self.assertEqual(conn.total_changes, changes)
                        by_id = {row["id"]: row for row in page["items"]}
                        for index, item in enumerate(items):
                            state = configured_states[index] if configured or index < 2 else "unconfigured"
                            self.assertEqual(by_id[item["id"]]["syncStatus"], state)
                            error = (
                                configured_errors[index]
                                if configured
                                else ("" if index < 2 else "未配置共享 Gitea Token，反馈已留档")
                            )
                            self.assertEqual(by_id[item["id"]]["syncError"], error if user["role"] == "admin" else "")
                        if not configured:
                            self.assertEqual(page["items"][-1]["syncStatus"], "synced")
                        if user["role"] != "admin":
                            self.assertTrue(
                                all(item["syncError"] == "" and item["issueUrl"] == "" for item in page["items"])
                            )

    def test_list_sql_budget_is_bounded_by_page_and_empty_pages_skip_metadata(self):
        for index in range(105):
            self.create(submission(title=f"批量列表 {index}"))
        with self.connect() as conn:
            for limit, offset, count in [(1, 0, 1), (20, 0, 20), (100, 0, 100), (200, 100, 5), (20, 105, 0)]:
                statements = []
                conn.set_trace_callback(statements.append)
                try:
                    page = service.list_page(conn, ACTOR, {"limit": str(limit), "offset": str(offset)})
                finally:
                    conn.set_trace_callback(None)
                self.assertEqual(len(page["items"]), count)
                self.assertEqual(page["total"], 105)
                self.assertEqual(len(statements), 4 if count else 2)

    def test_list_observes_remote_deletion_after_pagination(self):
        item = self.create()
        with self.connect() as conn:
            page = repo.list_page(conn, ACTOR, {}, True)
            with self.connect() as writer:
                writer.execute("UPDATE feedback SET status='deleted' WHERE id=?", (item["id"],))
                writer.execute(
                    "UPDATE feedback_tasks SET state='done',error='',uncertain=0 WHERE feedback_id=?", (item["id"],)
                )
            expected = service.present(conn, page["items"][0], ACTOR)
            with patch.object(repo, "list_page", return_value=page):
                actual = service.list_page(conn, ACTOR, {})["items"][0]
            self.assertEqual(actual, expected)
            self.assertEqual(actual["syncStatus"], "removed")

    def test_environment_does_not_accept_query_urls(self):
        with self.assertRaises(ValueError):
            self.create(submission(environment={"page": "https://host/app?token=secret"}))

    def test_append_and_encounter_are_idempotent_and_audited(self):
        item = self.create()
        body = {"requestId": str(uuid4()), "body": "我补充一下"}
        with self.connect() as conn:
            first = service.supplement(conn, ADMIN, item["id"], body)
        with self.connect() as conn:
            self.assertEqual(first["id"], service.supplement(conn, ADMIN, item["id"], body)["id"])
        for _ in range(2):
            with self.connect() as conn:
                self.assertEqual(service.encounter(conn, ADMIN, item["id"], {"encountered": True})["encounterCount"], 1)
        with self.connect() as conn:
            self.assertEqual(service.encounter(conn, ADMIN, item["id"], {"encountered": False})["encounterCount"], 0)
            self.assertEqual(repo.get(conn, item["id"])["description"], "详细描述")
        self.run_worker()
        self.assertEqual(len(self.client.issues), 1)
        self.assertEqual(len(self.detail(item["id"])["comments"]), 1)
        self.assertEqual(sum(sync.marker("encounters", item["id"]) in row["body"] for row in self.client.comments), 1)

    def test_no_token_keeps_local_record_and_admin_actions_guarded(self):
        with patch.object(service, "CAGELEDGER_GITEA_TOKEN", ""):
            item = self.create()
            self.assertEqual(item["syncStatus"], "unconfigured")
            with self.connect() as conn:
                with self.assertRaises(PermissionError):
                    service.integration(conn, ACTOR)
        with self.connect() as conn:
            with self.assertRaises(PermissionError):
                service.retry(conn, ACTOR, item["id"])

    def test_actual_screenshot_validation_limit_idempotency_and_ownership(self):
        item = self.create()
        identity = {"requestId": str(uuid4())}
        with self.connect() as conn:
            uploaded = files.upload(conn, ACTOR, item["id"], identity, "图片.png", screenshot(), self.root)
        with self.connect() as conn:
            self.assertEqual(
                files.upload(conn, ACTOR, item["id"], identity, "图片.png", screenshot(), self.root)["id"],
                uploaded["id"],
            )
        with self.connect() as conn:
            with self.assertRaises(PermissionError):
                files.upload(conn, ADMIN, item["id"], {"requestId": str(uuid4())}, "test.png", screenshot(), self.root)
        for _ in range(4):
            with self.connect() as conn:
                files.upload(conn, ACTOR, item["id"], {"requestId": str(uuid4())}, "test.png", screenshot(), self.root)
        with self.connect() as conn:
            with self.assertRaises(ValueError):
                files.upload(conn, ACTOR, item["id"], {"requestId": str(uuid4())}, "six.png", screenshot(), self.root)
        for invalid in (b"not png", b"x" * (files.MAX_BYTES + 1), screenshot()[:-8]):
            with self.subTest(size=len(invalid)), self.assertRaises(ValueError):
                files.validate(invalid)

    def test_issue_timeout_reconciles_without_duplicate_and_restore_keeps_binding(self):
        item = self.create()
        self.client.after_post = lambda: (_ for _ in ()).throw(RemoteError("timeout", uncertain=True))
        self.run_worker()
        self.assertEqual(len(self.client.issues), 1)
        self.make_due()
        self.run_worker()
        self.assertEqual(self.detail(item["id"])["item"]["issueNumber"], 1)
        self.assertEqual(len(self.client.issues), 1)
        with self.connect() as conn:
            uploaded = files.upload(
                conn, ACTOR, item["id"], {"requestId": str(uuid4())}, "restore.png", screenshot(), self.root
            )
            stored = files.accessible(conn, uploaded["id"])["storage_name"]
        self.run_worker()
        backup = self.root / "backup.sqlite"
        file_backup = self.root / "backup-files"
        file_backup.mkdir()
        shutil.copy2(self.root / stored, file_backup / stored)
        with self.connect() as conn, sqlite3.connect(backup) as target:
            conn.backup(target)
        (self.root / stored).unlink()
        shutil.copy2(backup, self.db)
        shutil.copy2(file_backup / stored, self.root / stored)
        with self.connect() as conn:
            repo.ensure_schema(conn)
            worker.recover(conn)
            restored = files.accessible(conn, uploaded["id"])
            self.assertEqual((self.root / restored["storage_name"]).read_bytes(), screenshot())
        self.run_worker()
        self.assertEqual(len(self.client.issues), 1)

    def test_unconfirmed_creation_never_blindly_reposts(self):
        item = self.create()
        self.client.fail = RemoteError("unknown timeout", uncertain=True)
        self.run_worker()
        self.make_due()
        self.run_worker()
        with self.connect() as conn:
            self.assertEqual(repo.sync_state(conn, item["id"])[0], "uncertain")
            service.retry(conn, ADMIN, item["id"])
        self.run_worker()
        self.assertFalse(self.client.issues)
        self.assertEqual(sum(method == "POST" for method, _, _ in self.client.calls), 1)

    def test_confirmed_connection_failure_retries_after_network_returns(self):
        item = self.create()
        self.client.fail = RemoteError("connection refused", uncertain=False)
        self.run_worker()
        self.assertFalse(self.client.issues)
        self.make_due()
        self.run_worker()
        self.assertEqual(self.detail(item["id"])["item"]["issueNumber"], 1)

    def test_restart_in_flight_creation_is_reconciled(self):
        item = self.create()
        self.client.issues.append({"number": 7, "body": sync.marker("feedback", item["id"]), "state": "open"})
        with self.connect() as conn:
            conn.execute("UPDATE feedback_tasks SET state='working',uncertain=1 WHERE kind='create'")
            worker.recover(conn)
        worker.run_once(self.connect, self.client, self.root)
        self.assertEqual(self.detail(item["id"])["item"]["issueNumber"], 7)
        self.assertFalse(any(call[0] == "POST" for call in self.client.calls))

    def test_repeated_database_locks_in_recovery_keep_worker_running(self):
        item = self.create()
        stop = threading.Event()
        states = []
        original_recover, original_run_once = worker.recover, worker.run_once
        self.client.after_post = stop.set

        def wait(_timeout):
            states.append((worker._health_state, worker._health_error))
            if len(states) > 10:
                stop.set()

        with (
            patch.multiple(
                worker,
                connect_db=self.connect,
                FEEDBACK_FILES_PATH=self.root,
                _stop=stop,
                _resume=threading.Event(),
                _health_state="recovering",
                _health_error="",
            ),
            patch.object(worker, "Client", return_value=self.client),
            patch.object(stop, "wait", side_effect=wait),
            patch.object(worker, "recover") as recovery,
            patch.object(worker, "run_once") as run,
        ):
            calls = 0

            def recover(conn):
                nonlocal calls
                calls += 1
                if calls in {1, 2, 4}:
                    raise sqlite3.OperationalError("database is locked")
                original_recover(conn)

            runs = 0

            def run_once(*args):
                nonlocal runs
                runs += 1
                if runs == 1:
                    raise sqlite3.OperationalError("database is locked")
                return original_run_once(*args)

            recovery.side_effect, run.side_effect = recover, run_once
            worker._run()
            self.assertEqual(worker._health_state, "running")
        self.assertEqual(len(self.client.issues), 1)
        self.assertEqual(self.detail(item["id"])["item"]["issueNumber"], 1)
        self.assertEqual(sum(state == "recovering" for state, _ in states), 4)
        self.assertTrue(all("数据库暂时繁忙" in error for state, error in states if state == "recovering"))

    def test_idle_queue_does_not_acquire_writer_lock(self):
        with self.connect() as writer, self.connect() as reader:
            writer.execute("BEGIN IMMEDIATE")
            reader.execute("PRAGMA busy_timeout=0")
            worker.recover(reader)
            self.assertFalse(worker.run_once(lambda: reader, self.client, self.root))

    def test_resume_restarts_dead_worker_once(self):
        dead, replacement = Mock(), Mock()
        dead.is_alive.return_value = False
        replacement.is_alive.return_value = True
        with (
            patch.multiple(
                worker,
                CAGELEDGER_GITEA_TOKEN="mock-token",
                _thread=dead,
                _stop=threading.Event(),
                _resume=threading.Event(),
                _health_state="running",
                _health_error="",
            ),
            patch.object(worker.threading, "Thread", return_value=replacement) as factory,
        ):
            self.assertEqual(worker.health()["workerState"], "stopped")
            worker.resume()
            worker.resume()
            self.assertEqual(worker.health()["workerState"], "recovering")
            self.assertTrue(worker._resume.is_set())
            factory.assert_called_once()
            replacement.start.assert_called_once()

    def test_integration_reports_stopped_worker_even_without_task_errors(self):
        self.create()
        with (
            patch.multiple(
                worker, CAGELEDGER_GITEA_TOKEN="mock-token", _thread=None, _health_state="running", _health_error=""
            ),
            self.connect() as conn,
        ):
            state = service.integration(conn, ADMIN)
            self.assertEqual(state["workerState"], "stopped")
            self.assertEqual(state["pending"], 1)
            self.assertEqual(state["errors"], 0)
            self.assertIn("同步 Gitea", state["workerError"])

    def test_admin_retry_enqueues_stale_refresh_and_resumes_worker(self):
        item = self.create()
        self.run_worker()
        with self.connect() as conn:
            conn.execute("UPDATE feedback SET last_synced_at='' WHERE id=?", (item["id"],))
        with patch.object(worker, "resume") as resume, self.connect() as conn:
            service.retry(conn, ADMIN, item["id"])
            task = conn.execute("SELECT state FROM feedback_tasks WHERE kind='refresh'").fetchone()
            self.assertEqual(task[0], "pending")
            resume.assert_called_once()
        self.run_worker()
        self.assertEqual(len(self.client.issues), 1)

    def test_comment_and_attachment_timeouts_reconcile(self):
        item = self.create()
        self.run_worker()
        with self.connect() as conn:
            comment = service.supplement(conn, ACTOR, item["id"], {"requestId": str(uuid4()), "body": "补充图片"})
        self.client.after_post = lambda: (_ for _ in ()).throw(RemoteError("timeout", uncertain=True))
        self.run_worker()
        self.make_due()
        self.run_worker()
        with self.connect() as conn:
            files.upload(
                conn,
                ACTOR,
                item["id"],
                {"requestId": str(uuid4()), "commentId": comment["id"]},
                "image.png",
                screenshot(),
                self.root,
            )
        self.client.after_post = lambda: (_ for _ in ()).throw(RemoteError("timeout", uncertain=True))
        self.run_worker()
        self.make_due()
        self.run_worker()
        self.assertEqual(len(self.client.comments), 1)
        self.assertEqual(sum(len(items) for items in self.client.assets.values()), 1)

    def test_repo_change_blocks_old_tasks_without_remote_writes(self):
        item = self.create()
        self.client.repository = REPOSITORY + "-new"
        self.run_worker()
        self.assertFalse(self.client.calls)
        with self.connect() as conn:
            self.assertIn("地址已变更", repo.sync_state(conn, item["id"])[1])

    def test_remote_comments_edits_deletions_internal_assets_and_original_preserved(self):
        item = self.create()
        self.run_worker()
        public = {"id": 10, "body": "公开回复", "user": {"login": "developer"}}
        internal = {"id": 11, "body": " \n【内部】不公开", "user": {"login": "developer"}}
        self.client.comments.extend([public, internal])
        self.client.assets["/issues/comments/10/assets"] = [
            {"id": 9, "name": "image.png", "size": 42, "browser_download_url": REPOSITORY + "/attachments/id"}
        ]
        self.refresh(item["id"])
        detail = self.detail(item["id"])
        self.assertEqual([row["body"] for row in detail["comments"]], ["公开回复"])
        self.assertFalse(any(path == "/issues/comments/11/assets" for _, path, _ in self.client.calls))
        attachment_id = detail["comments"][0]["attachments"][0]["id"]
        public["body"] = "修改公开回复"
        self.refresh(item["id"])
        self.assertEqual(self.detail(item["id"])["comments"][0]["body"], "修改公开回复")
        public["body"] = "【内部】现在改成内部"
        self.refresh(item["id"])
        self.assertFalse(self.detail(item["id"])["comments"])
        with self.connect() as conn:
            with self.assertRaises(LookupError):
                files.accessible(conn, attachment_id)
        public["body"] = "恢复公开"
        self.refresh(item["id"])
        self.client.comments.clear()
        self.refresh(item["id"])
        self.assertFalse(self.detail(item["id"])["comments"])
        self.assertEqual(self.detail(item["id"])["item"]["description"], "详细描述")

    def test_deleted_issue_removes_feedback_from_api_stops_tasks_and_audits(self):
        body = submission()
        item = self.create(body)
        with self.connect() as conn:
            attachment = files.upload(
                conn, ACTOR, item["id"], {"requestId": str(uuid4())}, "local.png", screenshot(), self.root
            )
        self.run_worker()
        with self.connect() as conn:
            local = service.supplement(conn, ACTOR, item["id"], {"requestId": str(uuid4()), "body": "原始补充"})
        self.run_worker()
        self.client.comments.append({"id": 20, "body": "远端回复", "user": {"login": "developer"}})
        self.client.comments[0]["body"] = "远端修改了本地补充"
        self.client.assets["/issues/comments/20/assets"] = [{"id": 9, "name": "remote.png", "size": 42}]
        self.refresh(item["id"])
        remote_attachment = next(row for row in self.detail(item["id"])["comments"] if row["source"] == "gitea")[
            "attachments"
        ][0]["id"]
        # Existing blocked refresh errors must be reconciled by polling, without manual database edits.
        with self.connect() as conn:
            conn.execute("UPDATE feedback_tasks SET state='blocked',error='旧404错误' WHERE kind='refresh'")
            repo.queue_stale(conn, age=-1)
        self.client.issues.clear()
        self.run_worker()
        with self.assertRaisesRegex(LookupError, "反馈已删除"):
            self.detail(item["id"])
        with self.assertRaisesRegex(LookupError, "反馈已删除"):
            self.create(body)
        with self.connect() as conn:
            self.assertEqual(repo.get(conn, item["id"])["status"], "deleted")
            for user in (ACTOR, ADMIN):
                for params in ({}, {"status": "deleted"}, {"mine": "1"}, {"keyword": body["title"]}):
                    self.assertEqual(service.list_page(conn, user, params)["total"], 0)
            for attachment_id in (attachment["id"], remote_attachment):
                with self.assertRaises(LookupError):
                    files.accessible(conn, attachment_id)
            self.assertEqual(service.integration(conn, ADMIN)["errors"], 0)
            payload = conn.execute(
                "SELECT payload FROM audit_events WHERE action='feedback.deleted' ORDER BY rowid DESC LIMIT 1"
            ).fetchone()[0]
            self.assertIn('"deleted"', payload)
            # Keep the request tombstone across restart/migration, so replay cannot recreate an issue.
            repo.ensure_schema(conn)
            repo.queue_stale(conn, age=-1)
            with self.assertRaisesRegex(LookupError, "反馈已删除"):
                service.queue_refresh(conn, item["id"])
        calls = len(self.client.calls)
        self.run_worker()
        self.assertEqual(len(self.client.calls), calls)
        for action in (
            lambda conn: service.supplement(conn, ACTOR, item["id"], {"requestId": str(uuid4()), "body": "新补充"}),
            lambda conn: service.encounter(conn, ACTOR, item["id"], {"encountered": True}),
            lambda conn: files.upload(
                conn, ACTOR, item["id"], {"requestId": str(uuid4())}, "new.png", screenshot(), self.root
            ),
            lambda conn: service.retry(conn, ADMIN, item["id"]),
            lambda conn: service.supplement(
                conn,
                ACTOR,
                item["id"],
                {
                    "requestId": conn.execute(
                        "SELECT request_id FROM feedback_comments WHERE id=?", (local["id"],)
                    ).fetchone()[0],
                    "body": "原始补充",
                },
            ),
        ):
            with self.connect() as conn, self.assertRaisesRegex(LookupError, "反馈已删除"):
                action(conn)

    def test_deleted_issue_during_pending_supplement_cancels_all_outbox_tasks(self):
        item = self.create()
        self.run_worker()
        with self.connect() as conn:
            service.supplement(conn, ACTOR, item["id"], {"requestId": str(uuid4()), "body": "待同步补充"})
        with self.connect() as conn:
            service.encounter(conn, ADMIN, item["id"], {"encountered": True})
        self.client.issues.clear()
        self.run_worker()
        with self.assertRaisesRegex(LookupError, "反馈已删除"):
            self.detail(item["id"])
        with self.connect() as conn:
            self.assertEqual(repo.get(conn, item["id"])["status"], "deleted")
            self.assertEqual(service.list_page(conn, ACTOR, {})["total"], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM feedback_tasks WHERE state!='done'").fetchone()[0], 0)
        self.assertEqual(sum(method == "POST" and path == "/issues" for method, path, _ in self.client.calls), 1)

    def test_resource_404_does_not_mean_issue_deleted_when_issue_still_exists(self):
        item = self.create()
        self.run_worker()
        self.client.fail = RemoteError("附件不存在", permanent=True, http_status=404)
        self.refresh(item["id"])
        self.assertEqual(self.detail(item["id"])["item"]["status"], "pending")
        with self.connect() as conn:
            self.assertEqual(repo.sync_state(conn, item["id"])[0], "error")

    def test_repository_or_issue_list_unavailable_does_not_mark_deleted(self):
        for failing_path in ("", "/issues?state=all&type=issues"):
            with self.subTest(path=failing_path):
                item = self.create()
                self.run_worker()
                self.client.issues.clear()
                original_request, original_pages = self.client.request, self.client.pages

                def request(method, path, body=None, failing_path=failing_path, original_request=original_request):
                    if path == failing_path:
                        raise RemoteError("仓库不可访问", permanent=True, http_status=404)
                    return original_request(method, path, body)

                def pages(path, failing_path=failing_path, original_pages=original_pages):
                    if path == failing_path:
                        raise RemoteError("列表不可访问", permanent=True, http_status=404)
                    return original_pages(path)

                self.client.request, self.client.pages = request, pages
                try:
                    self.refresh(item["id"])
                    self.assertEqual(self.detail(item["id"])["item"]["status"], "pending")
                    with self.connect() as conn:
                        self.assertEqual(repo.sync_state(conn, item["id"])[0], "error")
                finally:
                    self.client.request, self.client.pages = original_request, original_pages

    def test_issue_listing_contradicts_404_so_deletion_is_not_confirmed(self):
        item = self.create()
        self.run_worker()
        original_request = self.client.request

        def request(method, path, body=None):
            if path == "/issues/1":
                raise RemoteError("工单不可访问", permanent=True, http_status=404)
            return original_request(method, path, body)

        self.client.request = request
        self.refresh(item["id"])
        self.assertEqual(self.detail(item["id"])["item"]["status"], "pending")
        with self.connect() as conn:
            self.assertEqual(repo.sync_state(conn, item["id"])[0], "error")

    def test_state_mapping_assignees_milestone_and_reopening(self):
        item = self.create()
        self.run_worker()
        issue = self.client.issues[0]
        cases = [
            ({"state": "open", "labels": []}, "pending"),
            ({"state": "open", "labels": [{"name": "反馈/处理中"}]}, "in_progress"),
            ({"state": "open", "labels": [{"name": "反馈/待验证"}, {"name": "bug"}]}, "verification"),
            ({"state": "closed", "labels": []}, "closed"),
            ({"state": "closed", "labels": [{"name": "反馈/已解决"}]}, "resolved"),
            ({"state": "open", "labels": [{"name": "反馈/已解决"}]}, "pending"),
            ({"state": "open", "labels": [{"name": "反馈/待处理"}, {"name": "反馈/待验证"}]}, "conflict"),
        ]
        for change, expected in cases:
            issue.update(change)
            self.refresh(item["id"])
            self.assertEqual(self.detail(item["id"])["item"]["status"], expected)
        issue.update({"assignees": [{"login": "hugo"}], "milestone": {"title": "1.6.0"}})
        self.refresh(item["id"])
        self.assertEqual(self.detail(item["id"])["item"]["fixVersion"], "1.6.0")
        self.assertEqual(self.detail(item["id"])["item"]["assignees"], ["hugo"])

    def test_network_does_not_hold_write_transaction(self):
        self.create()
        original = self.client.request

        def request(*args):
            with self.connect() as conn:
                conn.execute("BEGIN IMMEDIATE")
                conn.execute("UPDATE feedback SET version=version+1")
            return original(*args)

        self.client.request = request
        self.run_worker()

    def test_auth_failure_stops_requests_until_explicit_admin_retry(self):
        item = self.create()
        original = self.client.request

        def denied(*args):
            self.client.auth_blocked = True
            raise RemoteError("权限不足", permanent=True)

        self.client.request = denied
        self.run_worker()
        self.assertFalse(worker.run_once(self.connect, self.client, self.root))
        with self.connect() as conn:
            self.assertEqual(repo.sync_state(conn, item["id"])[0], "error")
            service.retry(conn, ADMIN, item["id"])
        self.client.auth_blocked = False
        self.client.request = original
        self.run_worker()
        self.assertEqual(len(self.client.issues), 1)

    def test_worker_runs_without_update_check_enablement(self):
        with (
            patch.multiple(worker, CAGELEDGER_GITEA_TOKEN="mock", _thread=None),
            patch.object(worker.threading, "Thread") as thread,
            patch.object(system, "CAGELEDGER_UPDATE_CHECK_ENABLED", False),
        ):
            worker.start()
            thread.return_value.start.assert_called_once()

    def test_new_votes_during_sync_are_not_lost(self):
        item = self.create()
        self.run_worker()
        with self.connect() as conn:
            service.encounter(conn, ACTOR, item["id"], {"encountered": True})

        def add_vote():
            with self.connect() as conn:
                service.encounter(conn, ADMIN, item["id"], {"encountered": True})

        self.client.after_post = add_vote
        self.run_worker()
        statistics = [row for row in self.client.comments if sync.marker("encounters", item["id"]) in row["body"]]
        self.assertEqual(len(statistics), 1)
        self.assertIn("2 人", statistics[0]["body"])


class ClientTests(unittest.TestCase):
    def response(self, body=b"{}"):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = body
        return response

    def test_get_retries_transient_connection_and_response_timeouts(self):
        client = Client(REPOSITORY, "mock-token")
        for reason in (TimeoutError("read timed out"), ConnectionResetError("reset")):
            with (
                self.subTest(reason=type(reason).__name__),
                patch.object(
                    client.opener, "open", side_effect=[URLError(reason), self.response(b'{"number":1}')]
                ) as opened,
            ):
                self.assertEqual(client.request("GET", "/issues/1"), {"number": 1})
                self.assertEqual(opened.call_count, 2)

    def test_get_retries_are_bounded_and_do_not_leak_transport_details(self):
        client = Client(REPOSITORY, "mock-token")
        with (
            patch.object(
                client.opener, "open", side_effect=URLError(TimeoutError("sensitive transport detail"))
            ) as opened,
            self.assertRaises(RemoteError) as result,
        ):
            client.request("GET", "/issues/1")
        self.assertEqual(opened.call_count, 3)
        self.assertFalse(result.exception.uncertain)
        self.assertNotIn("sensitive", str(result.exception))

    def test_tls_handshake_timeout_before_post_is_retryable_not_uncertain(self):
        client = Client("https://example.test/hugo/cageledger", "mock-token")
        with (
            patch(
                "http.client.HTTPSConnection.connect", side_effect=TimeoutError("TLS handshake timed out")
            ) as connect,
            self.assertRaises(RemoteError) as result,
        ):
            client.request("POST", "/issues", {"title": "test"})
        self.assertEqual(connect.call_count, 3)
        self.assertFalse(result.exception.uncertain)
        self.assertFalse(result.exception.permanent)

    def test_post_retries_only_confirmed_unsent_connection_failure(self):
        client = Client(REPOSITORY, "mock-token")
        with patch.object(
            client.opener,
            "open",
            side_effect=[URLError(ConnectionSetupError(TimeoutError())), self.response(b'{"number":1}')],
        ) as opened:
            self.assertEqual(client.request("POST", "/issues", {"title": "test"}), {"number": 1})
            self.assertEqual(opened.call_count, 2)

    def test_post_response_timeout_does_not_repeat_remote_write(self):
        client = Client(REPOSITORY, "mock-token")
        response = self.response()
        response.read.side_effect = TimeoutError("response lost after write")
        with (
            patch.object(client.opener, "open", return_value=response) as opened,
            self.assertRaises(RemoteError) as result,
        ):
            client.request("POST", "/issues", {"title": "test"})
        self.assertEqual(opened.call_count, 1)
        self.assertTrue(result.exception.uncertain)

    def test_tls_certificate_verification_is_preserved_without_retry(self):
        client = Client("https://example.test/hugo/cageledger", "mock-token")
        with (
            patch(
                "http.client.HTTPSConnection.connect", side_effect=ssl.SSLCertVerificationError("invalid certificate")
            ) as connect,
            self.assertRaises(RemoteError) as result,
        ):
            client.request("POST", "/issues", {"title": "test"})
        self.assertEqual(connect.call_count, 1)
        self.assertFalse(result.exception.uncertain)

    def test_attachment_download_retries_safe_reads(self):
        client = Client(REPOSITORY, "mock-token")
        with patch.object(
            client.opener, "open", side_effect=[URLError(TimeoutError()), self.response(b"image")]
        ) as opened:
            self.assertEqual(client.download_asset(client.base + "/attachments/id"), b"image")
            self.assertEqual(opened.call_count, 2)

    def test_connection_refusal_is_retryable_but_timeout_is_uncertain(self):
        client = Client(REPOSITORY, "mock-token")
        for reason, uncertain in [(ConnectionRefusedError("refused"), False), (TimeoutError("timed out"), True)]:
            with (
                patch.object(client.opener, "open", side_effect=URLError(reason)),
                self.assertRaises(RemoteError) as error,
            ):
                client.request("POST", "/issues", {"title": "test"})
            self.assertEqual(error.exception.uncertain, uncertain)

    def test_http_404_keeps_status_for_safe_deletion_reconciliation(self):
        client = Client(REPOSITORY, "mock-token")
        with patch.object(client.opener, "open", side_effect=HTTPError(REPOSITORY, 404, "missing", {}, None)):
            with self.assertRaises(RemoteError) as result:
                client.request("GET", "/issues/1")
        self.assertEqual(result.exception.http_status, 404)
        self.assertTrue(result.exception.permanent)
        self.assertFalse(client.auth_blocked)

    def test_shared_readonly_token_keeps_release_read_and_issue_permission_error(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"tag_name":"v1.5.0"}')

            def do_POST(self):
                self.send_response(403)
                self.end_headers()
                self.wfile.write(b'{"message":"sensitive token must not leak"}')

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = Client(f"http://127.0.0.1:{server.server_port}/hugo/cageledger", "mock-readonly-token")
            with patch.multiple(
                system, CAGELEDGER_REPOSITORY_URL=client.repository, CAGELEDGER_GITEA_TOKEN="mock-readonly-token"
            ):
                self.assertEqual(system.latest_remote_release()["version"], "v1.5.0")
            self.assertEqual(client.request("GET", "/releases/latest")["tag_name"], "v1.5.0")
            with self.assertRaises(RemoteError) as result:
                client.request("POST", "/issues", {"title": "test"})
            self.assertTrue(result.exception.permanent)
            self.assertTrue(client.auth_blocked)
            self.assertNotIn("sensitive", str(result.exception))
            self.assertNotIn("mock-readonly-token", str(result.exception))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_untrusted_attachment_urls_are_rejected_before_network(self):
        client = Client(REPOSITORY, "mock-token")
        for url in (
            "http://evil.test/attachments/id",
            "file:///etc/passwd",
            "http://127.0.0.1:7777/attachments/../secret",
            "http://127.0.0.1:7777/attachments/id?token=x",
        ):
            with self.subTest(url=url), self.assertRaises(RemoteError):
                client.download_asset(url)


class FeedbackHttpTests(unittest.TestCase):
    setUp = FeedbackTests.setUp
    tearDown = FeedbackTests.tearDown
    connect = FeedbackTests.connect

    def test_http_authentication_admin_guard_and_immutable_routes(self):
        class Handler:
            path = "/api/feedback"
            user = ACTOR
            status = None
            payload = None

            def require_user(self):
                if not self.user:
                    self.send_json({"error": "请登录"}, 401)
                return self.user

            def send_json(self, payload, status=200):
                self.status, self.payload = status, payload

            def read_json_body(self):
                return submission()

        handler = Handler()
        with patch.object(web, "connect_db", self.connect):
            handler.user = None
            self.assertTrue(web.handle(handler, "GET", "/api/feedback"))
            self.assertEqual(handler.status, 401)
            handler.user = ACTOR
            web.handle(handler, "GET", "/api/feedback/integration")
            self.assertEqual(handler.status, 403)
            web.handle(handler, "POST", "/api/feedback")
            item = handler.payload["item"]
            web.handle(handler, "PUT", "/api/feedback/" + item["id"])
            self.assertEqual(handler.status, 404)
            handler.user = ADMIN
            handler.path = "/api/feedback/" + item["id"]
            web.handle(handler, "GET", handler.path)
            self.assertEqual(handler.payload["item"]["description"], "详细描述")
