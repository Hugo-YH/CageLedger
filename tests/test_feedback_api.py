"""Real HTTP/SQLite integration against a loopback-only mock Gitea."""

import http.cookiejar
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from contextlib import closing
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode, urlparse
from uuid import uuid4

from server_app.domains.feedback.gitea import RemoteError
from tests.test_api_contracts import ROOT, available_port, request_json, wait_for_server
from tests.test_feedback import FakeGitea, screenshot, submission


class FeedbackApiIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = FakeGitea()
        fake = cls.fake

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def dispatch(self, method):
                try:
                    self.respond(method)
                except RemoteError as exc:
                    self.send_response(exc.http_status or 503)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"message": str(exc)}).encode())

            def respond(self, method):
                path = urlparse(self.path).path.removeprefix("/api/v1/repos/hugo/cageledger")
                raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                if self.headers.get("Authorization") != "token mock-feedback-token":
                    self.send_response(403)
                    self.end_headers()
                    return
                if path.startswith("/attachments/"):
                    self.send_response(200)
                    self.send_header("Content-Type", "image/png")
                    self.end_headers()
                    self.wfile.write(screenshot())
                    return
                if method == "GET":
                    if "/assets/" in path:
                        parent, asset_id = path.rsplit("/", 1)
                        payload = next(value for value in fake.assets[parent] if value["id"] == int(asset_id))
                    elif path == "/issues" or path.endswith(("/comments", "/assets")):
                        payload = fake.pages(path)
                    else:
                        payload = fake.request("GET", path)
                elif path.endswith("/assets"):
                    message = BytesParser(policy=policy.default).parsebytes(
                        b"Content-Type: " + self.headers["Content-Type"].encode() + b"\r\n\r\n" + raw
                    )
                    part = next(message.iter_parts())
                    payload = fake.upload(
                        path, part.get_filename(), part.get_payload(decode=True), part.get_content_type()
                    )
                else:
                    payload = fake.request(method, path, json.loads(raw))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(payload).encode())

            def do_GET(self):
                self.dispatch("GET")

            def do_POST(self):
                self.dispatch("POST")

            def do_PATCH(self):
                self.dispatch("PATCH")

        cls.mock = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.mock_thread = threading.Thread(target=cls.mock.serve_forever, daemon=True)
        cls.mock_thread.start()
        cls.temp_dir = tempfile.TemporaryDirectory(prefix="cageledger-feedback-api-")
        cls.port = available_port()
        cls.repository = f"http://127.0.0.1:{cls.mock.server_port}/hugo/cageledger"
        env = {
            **os.environ,
            "CAGELEDGER_HOST": "127.0.0.1",
            "CAGELEDGER_PORT": str(cls.port),
            "CAGELEDGER_DB": str(Path(cls.temp_dir.name) / "feedback.sqlite"),
            "CAGELEDGER_DATA_ROOT": cls.temp_dir.name,
            "CAGELEDGER_IACUC_INDEX": str(Path(cls.temp_dir.name) / "index.json"),
            "CAGELEDGER_GITEA_TOKEN": "mock-feedback-token",
            "CAGELEDGER_REPOSITORY_URL": cls.repository,
            "CAGELEDGER_UPDATE_CHECK_ENABLED": "false",
            "CAGELEDGER_DEV_ASSETS": "1",
            "CAGELEDGER_ADMIN_USERNAME": "admin",
            "CAGELEDGER_ADMIN_PASSWORD": "admin123",
        }
        cls.server = subprocess.Popen(
            [sys.executable, "server.py"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        wait_for_server(cls.server, cls.base_url)
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        try:
            cls.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait(timeout=5)
        cls.mock.shutdown()
        cls.mock.server_close()
        cls.mock_thread.join()
        cls.temp_dir.cleanup()

    def request(self, path, method="GET", body=None):
        return request_json(self.base_url, path, method, body, self.opener)[1]

    def poll(self, feedback_id, predicate):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            detail = self.request("/api/feedback/" + feedback_id)
            if predicate(detail):
                return detail
            time.sleep(0.05)
        self.fail("mock feedback synchronization did not reach expected state")

    def test_real_routes_permissions_upload_worker_and_remote_projection(self):
        with self.assertRaises(urllib.error.HTTPError) as denied:
            request_json(self.base_url, "/api/feedback")
        self.assertEqual(denied.exception.code, 401)
        with self.assertRaises(urllib.error.HTTPError) as options_denied:
            request_json(self.base_url, "/api/feedback/filter-options?column=module")
        self.assertEqual(options_denied.exception.code, 401)
        options_denied.exception.close()
        denied.exception.close()
        self.request("/api/auth/login", "POST", {"username": "admin", "password": "admin123"})
        regular = "feedback-user-" + uuid4().hex[:8]
        self.request(
            "/api/users",
            "POST",
            {
                "username": regular,
                "displayName": "反馈同事",
                "password": "feedback-password",
                "role": "room_admin",
                "roomIds": [],
            },
        )
        self.request("/api/auth/logout", "POST", {})
        self.request("/api/auth/login", "POST", {"username": regular, "password": "feedback-password"})
        body = submission()
        item = self.request("/api/feedback", "POST", body)["item"]
        self.assertEqual(self.request("/api/feedback", "POST", body)["item"]["id"], item["id"])
        self.assertEqual(
            self.request("/api/feedback/filter-options?column=module")["items"],
            [{"value": body["module"], "label": body["module"], "count": 1}],
        )
        query = urlencode(
            {"columnFilters": json.dumps({"title": [body["title"]]}), "sortKey": "title", "sortDir": "asc"}
        )
        self.assertEqual(self.request("/api/feedback?" + query)["items"][0]["id"], item["id"])
        with self.assertRaises(urllib.error.HTTPError) as invalid:
            self.request("/api/feedback/filter-options?column=invalid")
        self.assertEqual(invalid.exception.code, 400)
        invalid.exception.close()
        for path in (
            "/api/feedback/integration",
            "/api/feedback/import/preview",
            "/api/feedback/import",
            "/api/feedback/" + item["id"] + "/retry",
        ):
            with self.assertRaises(urllib.error.HTTPError) as blocked:
                self.request(path, "POST" if path.endswith(("retry", "/import")) else "GET", {})
            self.assertEqual(blocked.exception.code, 403)
            blocked.exception.close()
        comment = self.request(
            f"/api/feedback/{item['id']}/comments", "POST", {"requestId": str(uuid4()), "body": "同事补充"}
        )["item"]
        boundary = "feedback-test-boundary"
        raw = (
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="screenshot.png"\r\nContent-Type: image/png\r\n\r\n'
            ).encode()
            + screenshot()
            + f"\r\n--{boundary}--\r\n".encode()
        )
        path = f"/api/feedback/{item['id']}/attachments?requestId={uuid4()}&commentId={comment['id']}"
        request = urllib.request.Request(
            self.base_url + path, raw, headers={"Content-Type": "multipart/form-data; boundary=" + boundary}
        )
        with self.opener.open(request) as response:
            attachment = json.load(response)["item"]
        with self.opener.open(self.base_url + attachment["url"]) as response:
            self.assertEqual(response.read(), screenshot())
        self.request(f"/api/feedback/{item['id']}/encounter", "PUT", {"encountered": True})
        detail = self.poll(item["id"], lambda value: value["item"]["syncStatus"] == "synced")
        self.assertEqual(detail["item"]["encounterCount"], 1)
        self.assertEqual(len(detail["comments"]), 1)
        self.assertEqual(detail["item"]["issueUrl"], "")
        self.assertEqual(len(self.fake.issues), 1)
        self.fake.issues[0].update(
            {"state": "closed", "labels": [{"name": "反馈/已解决"}], "milestone": {"title": "1.6.0"}}
        )
        self.request("/api/auth/logout", "POST", {})
        self.request("/api/auth/login", "POST", {"username": "admin", "password": "admin123"})
        # Reconcile remote status changes through the durable refresh queue.
        import sqlite3

        from server_app.domains.feedback import repository

        with closing(sqlite3.connect(Path(self.temp_dir.name) / "feedback.sqlite")) as conn, conn:
            conn.row_factory = sqlite3.Row
            repository.enqueue(conn, item["id"], "refresh")
        final = self.poll(item["id"], lambda value: value["item"]["status"] == "resolved")
        self.assertEqual(final["item"]["fixVersion"], "1.6.0")
        self.assertEqual(final["item"]["issueUrl"], self.repository + "/issues/1")
        integration = self.request("/api/feedback/integration")
        self.assertTrue(integration["configured"])
        self.assertEqual(integration["workerState"], "running")
        self.assertEqual(integration["workerError"], "")

        # Deletion in the mock Gitea removes every public API surface, including old attachment URLs.
        self.fake.issues.clear()
        with closing(sqlite3.connect(Path(self.temp_dir.name) / "feedback.sqlite")) as conn, conn:
            conn.row_factory = sqlite3.Row
            repository.enqueue(conn, item["id"], "refresh")
        deadline = time.monotonic() + 10
        while True:
            try:
                self.request("/api/feedback/" + item["id"])
            except urllib.error.HTTPError as error:
                self.assertEqual(error.code, 404)
                error.close()
                break
            if time.monotonic() >= deadline:
                self.fail("deleted feedback remained accessible")
            time.sleep(0.05)
        self.assertEqual(self.request("/api/feedback")["total"], 0)
        self.assertEqual(self.request("/api/feedback?status=deleted")["items"], [])
        for path, method, payload in (
            (attachment["url"], "GET", None),
            (f"/api/feedback/{item['id']}/sync", "POST", {}),
            (f"/api/feedback/{item['id']}/retry", "POST", {}),
            (f"/api/feedback/{item['id']}/comments", "POST", {"requestId": str(uuid4()), "body": "重试补充"}),
            (f"/api/feedback/{item['id']}/encounter", "PUT", {"encountered": True}),
        ):
            with self.assertRaises(urllib.error.HTTPError) as deleted:
                self.request(path, method, payload)
            self.assertEqual(deleted.exception.code, 404)
            deleted.exception.close()
        self.request("/api/auth/logout", "POST", {})
        self.request("/api/auth/login", "POST", {"username": regular, "password": "feedback-password"})
        with self.assertRaises(urllib.error.HTTPError) as replay:
            self.request("/api/feedback", "POST", body)
        self.assertEqual(replay.exception.code, 404)
        replay.exception.close()
        self.assertEqual(self.request("/api/feedback")["total"], 0)
        with closing(sqlite3.connect(Path(self.temp_dir.name) / "feedback.sqlite")) as conn, conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM feedback_tasks WHERE state!='done'").fetchone()[0], 0)
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM audit_events WHERE action='feedback.deleted'").fetchone()[0], 1
            )

    def test_z_historical_import_real_http_readonly_remote_and_authenticated_screenshots(self):
        from tests.test_feedback_import import issue

        self.request("/api/auth/login", "POST", {"username": "admin", "password": "admin123"})
        self.fake.issues = [issue(700)]
        self.fake.comments = []
        self.fake.assets["/issues/700/assets"] = [
            {
                "id": 701,
                "name": "history.png",
                "size": len(screenshot()),
                "browser_download_url": self.repository.split("/hugo/")[0] + "/attachments/mock-uuid",
            }
        ]
        calls = len(self.fake.calls)
        preview = self.request("/api/feedback/import/preview?state=closed&page=1")
        self.assertEqual(preview["items"][0]["reporter"], "张三")
        body = {"requestId": str(uuid4()), "repository": self.repository, "numbers": [700]}
        result = self.request("/api/feedback/import", "POST", body)
        self.assertEqual(result["items"][0]["outcome"], "imported")
        self.assertEqual(result, self.request("/api/feedback/import", "POST", body))
        feedback_id = result["items"][0]["feedbackId"]
        detail = self.request("/api/feedback/" + feedback_id)
        attachment = detail["attachments"][0]
        self.assertEqual(detail["item"]["status"], "resolved")
        with self.opener.open(self.base_url + attachment["url"]) as response:
            self.assertEqual(response.read(), screenshot())
            self.assertEqual(response.headers["Content-Type"], "image/png")
        self.assertTrue(all(call[0] == "GET" for call in self.fake.calls[calls:]))
        self.fake.issues[0]["body"] = "【内部】历史截图不可公开"
        with self.assertRaises(urllib.error.HTTPError) as hidden:
            self.opener.open(self.base_url + attachment["url"])
        self.assertEqual(hidden.exception.code, 404)
        hidden.exception.close()
        self.assertEqual(self.request("/api/feedback/" + feedback_id)["attachments"], [])
        with self.assertRaises(urllib.error.HTTPError) as unauthenticated:
            urllib.request.urlopen(self.base_url + attachment["url"])
        self.assertEqual(unauthenticated.exception.code, 401)
        unauthenticated.exception.close()
        with closing(sqlite3.connect(Path(self.temp_dir.name) / "feedback.sqlite")) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM feedback WHERE issue_number=700").fetchone()[0], 1)
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM audit_events WHERE action='feedback.imported'").fetchone()[0], 1
            )
