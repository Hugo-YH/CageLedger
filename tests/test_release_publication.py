import copy
import json
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CHANGELOG = """# 更新日志

## 1.5.0（Build 200） · 2026-10-06

### 中文发布说明

- 保留“引号”、"ASCII 引号"、\\路径和 `$(echo not-executed)` 文本
  第二行说明及 **Markdown** 格式

```text
## 9.9.9
### 代码示例中的标题
```

> 备注：本次发布包含多行说明。

## 1.4.0（Build 199） · 2026-10-05

### 上一个版本

- 不能混入正文的旧说明
"""
EXPECTED_BODY = CHANGELOG.split("## 1.4.0")[0].split("# 更新日志\n\n")[1].strip()


class ReleasePublicationTests(unittest.TestCase):
    def run_upload(
        self, existing=None, fail_upload=False, *, changelog=CHANGELOG, drop_body=False, lose_published_body=False
    ):
        state = {"release": copy.deepcopy(existing), "writes": [], "assets": [], "reads": []}
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
                state["reads"].append(self.path)
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
                state["release"] = {**payload, "id": 1, "published_at": date}
                if drop_body:
                    state["release"]["body"] = ""
                self.reply(state["release"], 201)

            def do_PATCH(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                state["writes"].append(("patch", payload))
                state["release"].update(payload)
                if drop_body and "body" in payload:
                    state["release"]["body"] = ""
                if lose_published_body and payload.get("draft") is False:
                    state["release"]["body"] = ""
                if payload.get("draft"):
                    state["release"]["published_at"] = "2026-10-06T05:00:00Z"
                self.reply(state["release"])

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repository"
            project = Path(__file__).resolve().parent.parent
            for relative in (
                "scripts/upload_release_package_local.sh",
                "scripts/release_notes_payload.mjs",
                "scripts/lib/release_notes.mjs",
            ):
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(project / relative, target)
            (root / "wiki").mkdir()
            (root / "wiki/更新日志.md").write_text(changelog, encoding="utf8")
            (root / "package.json").write_text(json.dumps({"version": "1.5.0", "build": 200}))
            subprocess.run(["git", "init", "-q", str(root)], check=True, capture_output=True)
            subprocess.run(
                ["git", "-C", str(root), "remote", "add", "origin", "https://example.invalid/test/cageledger.git"],
                check=True,
                capture_output=True,
            )
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
                    cwd=root,
                    env={
                        **os.environ,
                        "CAGELEDGER_GITEA_URL": f"http://127.0.0.1:{server.server_port}",
                        "CAGELEDGER_GITEA_TOKEN": "isolated-test-token",
                        "CAGELEDGER_GITEA_REPOSITORY": "test/cageledger",
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
        self.assertEqual(state["writes"][0][1]["body"], EXPECTED_BODY)
        self.assertEqual(state["release"]["body"], EXPECTED_BODY)
        self.assertTrue(state["reads"][-1].endswith("/releases/1"))

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
        self.assertEqual(state["release"]["body"], EXPECTED_BODY)
        again, retried = self.run_upload(state["release"])
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertNotIn(("patch", {"draft": True}), retried["writes"])
        self.assertEqual(retried["release"]["published_at"], state["release"]["published_at"])

    def test_failed_package_upload_does_not_publish_new_release(self):
        result, state = self.run_upload(fail_upload=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(state["release"]["draft"])
        self.assertNotIn(("patch", {"draft": False}), state["writes"])

    def test_existing_empty_release_gets_notes_without_reuploading_asset(self):
        release = {"id": 1, "tag_name": "v1.5.0", "draft": False, "published_at": "2026-10-06T05:00:00Z", "body": ""}
        result, state = self.run_upload(release)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(state["writes"][0], ("patch", {"name": "1.5.0（Build 200）", "body": EXPECTED_BODY}))
        self.assertEqual(state["release"]["body"], EXPECTED_BODY)
        self.assertNotIn(("upload", None), state["writes"])
        self.assertEqual(state["release"]["published_at"], release["published_at"])

    def test_invalid_notes_fail_before_any_request(self):
        for changelog in (
            CHANGELOG.replace("1.5.0", "1.5.1"),
            "## 1.5.0\n\n### 空说明\n",
            CHANGELOG + "\n## 1.5.0\n\n### 重复版本\n\n- 重复条目\n",
            CHANGELOG.split("\n```\n")[0],
            "## 1.5.0\n\n### 空条目\n\n-   \n",
            "## 1.5.0\n\n###   \n\n- 正常条目\n",
        ):
            with self.subTest(changelog=changelog[:40]):
                result, state = self.run_upload(changelog=changelog)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(state["reads"], [])
                self.assertEqual(state["writes"], [])

    def test_body_dropped_by_server_blocks_asset_and_publication(self):
        existing = {
            "id": 1,
            "tag_name": "v1.5.0",
            "draft": False,
            "published_at": "2026-10-06T05:00:00Z",
            "body": "old",
        }
        for release in (None, existing):
            with self.subTest(existing=bool(release)):
                result, state = self.run_upload(release, drop_body=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("body differs", result.stderr)
                self.assertEqual(len(state["writes"]), 1)
                self.assertEqual(state["release"]["draft"], release is None)

    def test_readback_detects_lost_body_after_publication(self):
        result, state = self.run_upload(lose_published_body=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("body differs", result.stderr)
        self.assertTrue(state["reads"][-1].endswith("/releases/1"))
        self.assertNotIn("Published package", result.stdout)

    def test_crlf_notes_are_normalized_without_losing_markdown(self):
        result, state = self.run_upload(changelog=CHANGELOG.replace("\n", "\r\n"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(state["release"]["body"], EXPECTED_BODY)
