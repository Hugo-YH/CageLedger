import io
import sqlite3
import tempfile
import unittest
from email.utils import format_datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from server_app.domains.administration.auth import create_session
from server_app.shared.sqlite import ClosingConnection
from server_app.web import workflow_actions

USER = {"id": "u", "username": "test-admin", "displayName": "测试管理员", "role": "admin"}


class _Handler(workflow_actions.WorkflowActionsMixin):
    headers = {}
    client_address = ("127.0.0.1", 1)

    def __init__(self):
        self.responses = []
        self.response_headers = {}
        self.wfile = io.BytesIO()

    def read_json_body(self):
        return {"username": "test-admin", "password": "test-only-password"}

    def send_response(self, status):
        self.responses.append(status)

    def send_header(self, key, value):
        self.response_headers[key] = value

    def end_headers(self):
        pass


class LoginAtomicityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "test.sqlite"
        with self.connect() as conn:
            conn.executescript(
                "CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,created_at TEXT,expires_at TEXT); CREATE TABLE login_audits(action TEXT)"
            )

    def connect(self):
        return sqlite3.connect(self.path, factory=ClosingConnection)

    def login(self, writer):
        handler = _Handler()
        with (
            patch.object(
                workflow_actions,
                "app_ports",
                return_value=SimpleNamespace(format_http_date=lambda value: format_datetime(value, usegmt=True)),
            ),
            patch.object(workflow_actions, "connect_db", self.connect),
            patch.object(workflow_actions, "authenticate", return_value=USER),
            patch.object(workflow_actions, "write_audit_events", side_effect=writer),
            patch.object(workflow_actions, "session_payload", return_value={"user": USER}),
        ):
            handler.handle_login()
        return handler

    def test_audit_failure_rolls_back_session_and_does_not_send_cookie(self):
        handler = _Handler()

        def fail(conn, events):
            conn.execute("INSERT INTO login_audits VALUES ('auth.login')")
            raise sqlite3.OperationalError("simulated audit failure")

        with (
            patch.object(
                workflow_actions,
                "app_ports",
                return_value=SimpleNamespace(format_http_date=lambda value: format_datetime(value, usegmt=True)),
            ),
            patch.object(workflow_actions, "connect_db", self.connect),
            patch.object(workflow_actions, "authenticate", return_value=USER),
            patch.object(workflow_actions, "write_audit_events", side_effect=fail),
        ):
            with self.assertRaises(sqlite3.OperationalError):
                handler.handle_login()
        self.assertEqual(handler.responses, [])
        self.assertNotIn("Set-Cookie", handler.response_headers)
        with self.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM login_audits").fetchone()[0], 0)

    def test_success_commits_session_and_audit_together(self):
        def write(conn, events):
            self.assertTrue(conn.in_transaction)
            conn.execute("INSERT INTO login_audits VALUES (?)", (events[0]["action"],))

        handler = self.login(write)
        self.assertEqual(handler.responses, [200])
        self.assertIn("HttpOnly", handler.response_headers["Set-Cookie"])
        with self.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT action FROM login_audits").fetchone()[0], "auth.login")

    def test_legacy_create_session_still_commits_by_default(self):
        with self.connect() as conn:
            token, _ = create_session(conn, "u")
            self.assertFalse(conn.in_transaction)
            self.assertTrue(token)
        with self.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
