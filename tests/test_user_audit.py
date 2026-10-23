import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.administration import users
from server_app.legacy import initialize_schema
from server_app.repositories.audit_storage import read_payload
from server_app.repositories.users import insert_session
from server_app.shared.concurrency import StaleWriteError
from server_app.shared.sqlite import ClosingConnection

ADMIN = {
    "id": "audit-admin",
    "username": "audit-admin",
    "displayName": "审计管理员",
    "role": "admin",
    "roomIds": [],
}


class UserAuditTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "users.sqlite"
        with self.connect() as conn:
            initialize_schema(conn)
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")

    def connect(self):
        conn = sqlite3.connect(self.path, factory=ClosingConnection)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def create(self, username="target", **overrides):
        payload = {
            "username": username,
            "password": "initial-password",
            "displayName": "目标账号",
            "phone": "10086",
            "role": "room_admin",
            "roomIds": ["room-a"],
            "billingLockAllowed": False,
            **overrides,
        }
        with self.connect() as conn:
            return users.create_user(conn, payload, ADMIN)

    def event(self, action):
        with self.connect() as conn:
            row = conn.execute(
                "SELECT id FROM audit_events WHERE action=? ORDER BY rowid DESC LIMIT 1", (action,)
            ).fetchone()
            self.assertIsNotNone(row, action)
            return json.loads(read_payload(conn, row["id"]))

    def event_count(self, action):
        with self.connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM audit_events WHERE action=?", (action,)).fetchone()[0]

    def seed_session(self, user_id):
        with self.connect() as conn:
            insert_session(
                conn, "session-token-hash", user_id, "2026-10-23T00:00:00+00:00", "2099-10-23T00:00:00+00:00"
            )
            conn.commit()

    def assert_public_snapshot(self, snapshot):
        self.assertIsInstance(snapshot, dict)
        self.assertTrue(
            set(snapshot).issubset(
                {
                    "id",
                    "username",
                    "displayName",
                    "phone",
                    "role",
                    "roomIds",
                    "billingLockAllowed",
                    "active",
                    "updatedAt",
                    "passwordChanged",
                }
            )
        )
        self.assertNotIn("password", snapshot)
        self.assertNotIn("password_hash", snapshot)
        self.assertNotIn("sessions", snapshot)

    def assert_event_identity(self, event, action, user_id, actor=ADMIN):
        self.assertEqual(event["action"], action)
        self.assertEqual(event["entityType"], "user")
        self.assertEqual(event["entityId"], user_id)
        self.assertEqual(event["actorUserId"], actor["id"])
        self.assertEqual(event["actorUsername"], actor["username"])
        self.assertEqual(event["actorDisplayName"], actor["displayName"])
        self.assertTrue(event["at"])

    def test_create_keeps_legacy_signature_and_audits_system_actor_without_secret_fields(self):
        with self.connect() as conn:
            created = users.create_user(conn, {"username": "legacy", "password": "secret", "role": "room_admin"})
        event = self.event("user.created")
        self.assert_event_identity(
            event,
            "user.created",
            created["id"],
            {"id": "system", "username": "system", "displayName": "系统"},
        )
        self.assertIsNone(event["before"])
        self.assert_public_snapshot(event["after"])
        self.assertTrue(event["after"]["passwordChanged"])
        self.assertEqual(event["after"]["username"], "legacy")

    def test_update_password_reset_invalidates_sessions_and_records_public_before_after(self):
        created = self.create()
        self.seed_session(created["id"])
        with self.connect() as conn:
            updated = users.update_user(
                conn,
                ADMIN,
                created["id"],
                {
                    "username": "target-renamed",
                    "displayName": "更新后账号",
                    "phone": "12345",
                    "password": "replacement-password",
                    "role": "admin",
                    "roomIds": [],
                    "billingLockAllowed": True,
                    "expectedUpdatedAt": created["updatedAt"],
                },
            )
        event = self.event("user.updated")
        self.assert_event_identity(event, "user.updated", created["id"])
        self.assert_public_snapshot(event["before"])
        self.assert_public_snapshot(event["after"])
        self.assertEqual(event["before"]["username"], "target")
        self.assertEqual(event["after"]["username"], "target-renamed")
        self.assertTrue(event["after"]["passwordChanged"])
        self.assertEqual(updated["updatedAt"], event["after"]["updatedAt"])
        with self.connect() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM sessions WHERE user_id=?", (created["id"],)).fetchone()[0], 0
            )

    def test_self_phone_update_ignores_password_and_other_fields_without_invalidating_session(self):
        created = self.create()
        self.seed_session(created["id"])
        actor = {**ADMIN, "id": created["id"], "username": created["username"], "displayName": created["displayName"]}
        with self.connect() as conn:
            updated = users.update_user(
                conn,
                actor,
                created["id"],
                {
                    "phone": "self-phone",
                    "username": "ignored-name",
                    "displayName": "ignored-display",
                    "password": "ignored-password",
                    "role": "admin",
                    "roomIds": [],
                    "billingLockAllowed": True,
                    "expectedUpdatedAt": created["updatedAt"],
                },
            )
        event = self.event("user.updated")
        self.assertEqual(updated["phone"], "self-phone")
        self.assertEqual(updated["username"], created["username"])
        self.assertEqual(updated["role"], created["role"])
        self.assertFalse(event["after"]["passwordChanged"])
        with self.connect() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM sessions WHERE user_id=?", (created["id"],)).fetchone()[0], 1
            )

    def test_delete_records_public_before_and_removes_user_sessions(self):
        created = self.create()
        self.seed_session(created["id"])
        with self.connect() as conn:
            users.delete_user(conn, ADMIN, created["id"])
        event = self.event("user.deleted")
        self.assert_event_identity(event, "user.deleted", created["id"])
        self.assert_public_snapshot(event["before"])
        self.assertIsNone(event["after"])
        with self.connect() as conn:
            self.assertIsNone(conn.execute("SELECT id FROM users WHERE id=?", (created["id"],)).fetchone())
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM sessions WHERE user_id=?", (created["id"],)).fetchone()[0], 0
            )

    def test_legacy_update_without_version_still_saves_and_audits_once(self):
        created = self.create()
        with self.connect() as conn:
            updated = users.update_user(conn, ADMIN, created["id"], {"phone": "legacy-phone"})
        self.assertEqual(updated["phone"], "legacy-phone")
        self.assertEqual(self.event_count("user.updated"), 1)
        event = self.event("user.updated")
        self.assertEqual(event["before"]["phone"], "10086")
        self.assertEqual(event["after"]["phone"], "legacy-phone")
        self.assertFalse(event["after"]["passwordChanged"])

    def test_rejected_duplicate_stale_and_self_delete_do_not_add_success_events(self):
        created = self.create()
        created_events = self.event_count("user.created")
        with self.assertRaises(sqlite3.IntegrityError):
            self.create("target", displayName="重复账号")
        self.assertEqual(self.event_count("user.created"), created_events)

        with self.connect() as conn:
            updated = users.update_user(
                conn, ADMIN, created["id"], {"phone": "fresh", "expectedUpdatedAt": created["updatedAt"]}
            )
        update_events = self.event_count("user.updated")
        with self.connect() as conn:
            with self.assertRaises(StaleWriteError):
                users.update_user(
                    conn, ADMIN, created["id"], {"phone": "stale", "expectedUpdatedAt": created["updatedAt"]}
                )
        self.assertEqual(self.event_count("user.updated"), update_events)
        self.assertNotEqual(updated["updatedAt"], created["updatedAt"])

        delete_events = self.event_count("user.deleted")
        with self.connect() as conn:
            with self.assertRaises(PermissionError):
                users.delete_user(conn, {**ADMIN, "id": created["id"]}, created["id"])
        self.assertEqual(self.event_count("user.deleted"), delete_events)

    def test_audit_insertion_failure_rolls_back_create_update_delete_and_sessions(self):
        with patch(
            "server_app.domains.administration.users.write_audit_events", side_effect=RuntimeError("audit failed")
        ):
            with self.assertRaisesRegex(RuntimeError, "audit failed"):
                self.create("audit-create")
        with self.connect() as conn:
            self.assertIsNone(conn.execute("SELECT id FROM users WHERE username='audit-create'").fetchone())
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM audit_events WHERE action='user.created'").fetchone()[0], 0
            )

        created = self.create("audit-target")
        self.seed_session(created["id"])
        with patch(
            "server_app.domains.administration.users.write_audit_events", side_effect=RuntimeError("audit failed")
        ):
            with self.assertRaisesRegex(RuntimeError, "audit failed"):
                with self.connect() as conn:
                    users.update_user(
                        conn,
                        ADMIN,
                        created["id"],
                        {
                            "phone": "must-rollback",
                            "password": "new-password",
                            "expectedUpdatedAt": created["updatedAt"],
                        },
                    )
        with self.connect() as conn:
            row = conn.execute("SELECT phone FROM users WHERE id=?", (created["id"],)).fetchone()
            self.assertEqual(row["phone"], "10086")
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM sessions WHERE user_id=?", (created["id"],)).fetchone()[0], 1
            )
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM audit_events WHERE action='user.updated'").fetchone()[0], 0
            )

        with patch(
            "server_app.domains.administration.users.write_audit_events", side_effect=RuntimeError("audit failed")
        ):
            with self.assertRaisesRegex(RuntimeError, "audit failed"):
                with self.connect() as conn:
                    users.delete_user(conn, ADMIN, created["id"])
        with self.connect() as conn:
            self.assertIsNotNone(conn.execute("SELECT id FROM users WHERE id=?", (created["id"],)).fetchone())
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM sessions WHERE user_id=?", (created["id"],)).fetchone()[0], 1
            )
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM audit_events WHERE action='user.deleted'").fetchone()[0], 0
            )
