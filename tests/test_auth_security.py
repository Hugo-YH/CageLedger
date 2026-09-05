import sqlite3
import unittest
from unittest.mock import patch

from server_app import config
from server_app.domains.administration.auth import create_session
from server_app.legacy import initialize_schema
from server_app.shared.sqlite import ClosingConnection
from server_app.web import workflow_actions
from server_app.web.login_throttle import LoginThrottle


class LoginThrottleTests(unittest.TestCase):
    def test_limits_account_and_expires_failures(self):
        now = [100.0]
        throttle = LoginThrottle(account_limit=2, ip_limit=10, window_seconds=30, clock=lambda: now[0])
        throttle.record_failure("127.0.0.1", "Admin")
        throttle.record_failure("127.0.0.1", "admin")
        self.assertEqual(throttle.retry_after("127.0.0.1", "ADMIN"), 30)
        now[0] = 131
        self.assertEqual(throttle.retry_after("127.0.0.1", "admin"), 0)

    def test_limits_failures_across_usernames_per_address(self):
        throttle = LoginThrottle(account_limit=5, ip_limit=2, window_seconds=30, clock=lambda: 100.0)
        throttle.record_failure("127.0.0.1", "first")
        throttle.record_failure("127.0.0.1", "second")
        self.assertEqual(throttle.retry_after("127.0.0.1", "third"), 30)
        self.assertEqual(throttle.retry_after("127.0.0.2", "third"), 0)

    def test_success_clears_only_matching_account_limit(self):
        throttle = LoginThrottle(account_limit=1, ip_limit=10, window_seconds=30, clock=lambda: 100.0)
        throttle.record_failure("127.0.0.1", "first")
        throttle.record_failure("127.0.0.1", "second")
        throttle.clear_account("127.0.0.1", "first")
        self.assertEqual(throttle.retry_after("127.0.0.1", "first"), 0)
        self.assertEqual(throttle.retry_after("127.0.0.1", "second"), 30)


class AuthenticationConfigurationTests(unittest.TestCase):
    def test_session_creation_removes_expired_sessions(self):
        with sqlite3.connect(":memory:", factory=ClosingConnection) as conn:
            conn.row_factory = sqlite3.Row
            initialize_schema(conn)
            user_id = conn.execute("SELECT id FROM users LIMIT 1").fetchone()[0]
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('expired', ?, '', '2000-01-01')",
                (user_id,),
            )
            create_session(conn, user_id)
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM sessions WHERE token_hash = 'expired'").fetchone()[0], 0
            )

    def test_secure_cookie_is_configurable(self):
        with patch.object(workflow_actions, "SESSION_COOKIE_SECURE", True):
            cookie = workflow_actions._session_cookie("token", "Max-Age=1")
        self.assertIn("; Secure", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Lax", cookie)

    def test_invalid_numeric_environment_uses_safe_default(self):
        with patch.dict("os.environ", {"BROKEN_INTEGER": "not-a-number"}):
            self.assertEqual(config._env_int("BROKEN_INTEGER", 7, 1, 10), 7)
