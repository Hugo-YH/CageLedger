"""Generated feedback payloads, actors and deterministic in-memory remote double."""

import copy
import io
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from PIL import Image

from server_app.domains.feedback import repository as repo
from server_app.domains.feedback import service
from server_app.domains.feedback.gitea import RemoteError
from server_app.shared.sqlite import ClosingConnection


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


REPOSITORY = "http://127.0.0.1:7777/hugo/cageledger"


ACTOR = {"id": "colleague", "username": "tester", "displayName": "测试同事", "role": "room_admin"}


ADMIN = {**ACTOR, "id": "admin", "role": "admin"}


class FeedbackFixture:
    """Shared generated-database lifecycle without discoverable test cases."""

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
