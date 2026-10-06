import copy
import json
import os
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class ReleasePublicationTests(unittest.TestCase):
    def run_upload(self, existing=None, fail_upload=False):
        state = {"release": copy.deepcopy(existing), "writes": [], "assets": []}
        if existing:
            state["assets"] = [{"id": 9, "name": "package.tar.gz"}]

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def reply(self, value, status=200):
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(value).encode())

            def do_GET(self):
                if self.path.endswith("/assets"):
                    self.reply(state["assets"])
                elif state["release"]:
                    self.reply(state["release"])
                else:
                    self.reply({}, 404)

            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                if "/assets?" in self.path:
                    state["writes"].append(("upload", None))
                    if fail_upload:
                        self.reply({}, 500)
                        return
                    state["assets"].append({"id": 9, "name": "package.tar.gz"})
                    self.reply(state["assets"][-1], 201)
                    return
                payload = json.loads(body)
                state["writes"].append(("create", payload))
                date = "2026-10-06T05:00:00Z" if payload.get("draft") else "1970-01-01T00:00:00Z"
                state["release"] = {**payload, "id": 1, "published_at": date, "body": "saved notes"}
                self.reply(state["release"], 201)

            def do_PATCH(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                state["writes"].append(("patch", payload))
                state["release"].update(payload)
                if payload.get("draft"):
                    state["release"]["published_at"] = "2026-10-06T05:00:00Z"
                self.reply(state["release"])

        with tempfile.TemporaryDirectory() as tmp:
            package = Path(tmp) / "package.tar.gz"
            package.write_bytes(b"test package")
            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                result = subprocess.run(
                    [
                        "bash",
                        "scripts/upload_release_package_local.sh",
                        "--version",
                        "1.5.0",
                        "--package",
                        str(package),
                    ],
                    cwd=Path(__file__).resolve().parent.parent,
                    env={
                        **os.environ,
                        "CAGELEDGER_GITEA_URL": f"http://127.0.0.1:{server.server_port}",
                        "CAGELEDGER_GITEA_TOKEN": "isolated-test-token",
                    },
                    text=True,
                    capture_output=True,
                    timeout=15,
                )
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
        return result, state

    def test_new_release_uploads_before_publishing_and_initializes_date(self):
        result, state = self.run_upload()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(state["writes"][0][1]["draft"])
        self.assertEqual(state["writes"][1][0], "upload")
        self.assertEqual(state["writes"][-1], ("patch", {"draft": False}))
        self.assertFalse(state["release"]["published_at"].startswith("1970"))

    def test_epoch_repair_preserves_assets_and_normal_retry_keeps_date(self):
        release = {
            "id": 1,
            "tag_name": "v1.5.0",
            "draft": False,
            "published_at": "1970-01-01T00:00:00Z",
            "body": "saved notes",
        }
        result, state = self.run_upload(release)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(("patch", {"draft": True}), state["writes"])
        self.assertNotIn(("upload", None), state["writes"])
        self.assertEqual(state["assets"], [{"id": 9, "name": "package.tar.gz"}])
        self.assertEqual(state["release"]["body"], "saved notes")
        again, retried = self.run_upload(state["release"])
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertNotIn(("patch", {"draft": True}), retried["writes"])
        self.assertEqual(retried["release"]["published_at"], state["release"]["published_at"])

    def test_failed_package_upload_does_not_publish_new_release(self):
        result, state = self.run_upload(fail_upload=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(state["release"]["draft"])
        self.assertNotIn(("patch", {"draft": False}), state["writes"])
