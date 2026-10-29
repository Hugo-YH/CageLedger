import unittest
from unittest.mock import Mock, patch

from server_app.domains.administration import auth


class BootstrapSecurityTests(unittest.TestCase):
    def test_existing_production_users_are_never_changed_by_bootstrap_configuration(self):
        conn = Mock()
        with (
            patch.object(auth, "ENVIRONMENT", "production"),
            patch.object(auth, "DEFAULT_ADMIN_PASSWORD", ""),
            patch.object(auth, "has_any_user", return_value=True),
            patch.object(auth, "insert_user") as insert,
        ):
            auth.ensure_default_admin(conn)
            insert.assert_not_called()
            conn.commit.assert_not_called()

    def test_first_production_admin_requires_an_explicit_strong_password(self):
        for password in ("", "admin123", "short"):
            with (
                self.subTest(password=password),
                patch.object(auth, "ENVIRONMENT", "production"),
                patch.object(auth, "DEFAULT_ADMIN_PASSWORD", password),
                patch.object(auth, "has_any_user", return_value=False),
                patch.object(auth, "insert_user") as insert,
            ):
                with self.assertRaisesRegex(RuntimeError, "CAGELEDGER_ADMIN_PASSWORD"):
                    auth.ensure_default_admin(Mock())
                insert.assert_not_called()

    def test_configured_production_bootstrap_and_legacy_development_remain_supported(self):
        for environment, password in (("production", "test-only-random-credential-123"), ("development", "admin123")):
            with (
                self.subTest(environment=environment),
                patch.object(auth, "ENVIRONMENT", environment),
                patch.object(auth, "DEFAULT_ADMIN_PASSWORD", password),
                patch.object(auth, "has_any_user", return_value=False),
                patch.object(auth, "insert_user") as insert,
            ):
                conn = Mock()
                auth.ensure_default_admin(conn)
                stored = insert.call_args.args[1]["password_hash"]
                self.assertNotEqual(stored, password)
                self.assertTrue(auth.verify_password(password, stored))
                conn.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
