import copy
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock, patch

from server_app.domains.state.entity_rules import empty_state
from server_app.domains.state.persistence import assemble_state, write_normalized_state
from server_app.domains.system_features import service
from server_app.domains.system_features.session import session_payload
from server_app.legacy import initialize_schema
from server_app.persistence.system_features import ensure_schema
from server_app.repositories.audit_storage import read_payload
from server_app.repositories.payload import read_updated_at
from server_app.shared.concurrency import StaleWriteError
from server_app.web import router_registry
from server_app.web import system_features as web

ADMIN = {"id": "admin", "username": "admin", "displayName": "系统管理员", "role": "admin"}
STAFF = {"id": "room", "username": "room", "displayName": "房间管理员", "role": "room_admin"}


class SystemFeatureTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        initialize_schema(self.conn)
        self.conn.commit()
        self.addCleanup(self.conn.close)

    def request(self, **changes):
        current = service.read(self.conn, ADMIN)
        return {"enabled": {**current["enabled"], **changes}, "expectedUpdatedAt": current["updatedAt"]}

    def audits(self):
        return [
            json.loads(read_payload(self.conn, row[0]))
            for row in self.conn.execute("SELECT id FROM audit_events WHERE action='system_features.updated'")
        ]

    def test_defaults_are_all_enabled_and_reads_and_repeated_migration_do_not_persist(self):
        before = list(self.conn.iterdump())
        for actor in (ADMIN, STAFF):
            item = service.read(self.conn, actor)
            self.assertEqual(item["enabled"], dict.fromkeys(service.MODULES, True))
            self.assertIsNone(item["updatedAt"])
        ensure_schema(self.conn)
        ensure_schema(self.conn)
        self.assertEqual(list(self.conn.iterdump()), before)
        self.assertEqual(self.audits(), [])

    def test_session_feature_opt_in_is_read_only_and_falls_back_on_invalid_configuration(self):
        before = list(self.conn.iterdump())
        for actor in (ADMIN, STAFF):
            self.assertEqual(session_payload(self.conn, actor, False), {"user": actor})
            self.assertEqual(
                session_payload(self.conn, actor, True), {"user": actor, "features": service.read(self.conn, actor)}
            )
        self.assertEqual(list(self.conn.iterdump()), before)
        self.conn.execute("INSERT INTO system_feature_settings VALUES ('default', '{bad', '2026-01-01')")
        self.assertEqual(session_payload(self.conn, ADMIN, True), {"user": ADMIN})
        with self.assertRaises(ValueError):
            service.read(self.conn, ADMIN)

    def test_me_opt_in_uses_same_connection_and_authenticates_before_features(self):
        handler = Mock(path="/api/auth/me?include=features")
        handler.session_token.return_value = "token"
        with (
            patch.object(router_registry, "connect_db", return_value=self.conn),
            patch.object(router_registry, "user_from_token", return_value=STAFF) as auth,
        ):
            result = router_registry.current_session_response(handler, {})
        self.assertEqual(result.payload, {"user": STAFF, "features": service.read(self.conn, STAFF)})
        auth.assert_called_once_with(self.conn, "token")
        handler.path = "/api/auth/me"
        handler.current_user.return_value = ADMIN
        self.assertEqual(router_registry.current_session_response(handler, {}).payload, {"user": ADMIN})
        handler.path = "/api/auth/me?include=features"
        with (
            patch.object(router_registry, "connect_db", return_value=self.conn),
            patch.object(router_registry, "user_from_token", return_value=None),
            patch.object(router_registry, "session_payload", side_effect=AssertionError("unauthorized feature read")),
        ):
            result = router_registry.current_session_response(handler, {})
        self.assertEqual(result.status, 401)
        self.assertEqual(result.payload, {"user": None})

    def test_save_and_restore_keep_complete_actor_and_before_after_audit(self):
        previous_updated = read_updated_at(self.conn)
        with self.conn:
            hidden = service.save(self.conn, ADMIN, self.request(quarantine=False, **{"technical-services": False}))
        self.assertFalse(service.read(self.conn, STAFF)["enabled"]["quarantine"])
        self.assertEqual(read_updated_at(self.conn), previous_updated)
        event = self.audits()[0]
        self.assertEqual(event["actorUserId"], ADMIN["id"])
        self.assertEqual(event["actorUsername"], ADMIN["username"])
        self.assertEqual(event["before"]["enabled"], dict.fromkeys(service.MODULES, True))
        self.assertEqual(event["after"], hidden)
        self.assertIn("隐藏检疫管理", event["message"])
        self.assertIn("隐藏技术服务费管理", event["message"])
        with self.conn:
            shown = service.save(self.conn, ADMIN, self.request(quarantine=True, **{"technical-services": True}))
        self.assertTrue(all(shown["enabled"].values()))
        self.assertIn("开启检疫管理", self.audits()[-1]["message"])
        self.assertEqual(len(self.audits()), 2)

    def test_no_change_does_not_append_an_audit_or_update_version(self):
        with self.conn:
            initial = service.save(self.conn, ADMIN, self.request())
        self.assertIsNone(initial["updatedAt"])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM system_feature_settings").fetchone()[0], 0)
        with self.conn:
            changed = service.save(self.conn, ADMIN, self.request(cages=False))
        with self.conn:
            repeated = service.save(self.conn, ADMIN, self.request())
        self.assertEqual(changed, repeated)
        self.assertEqual(len(self.audits()), 1)

    def test_permissions_precede_queries_and_invalid_flags_or_versions_do_not_write(self):
        connection = Mock()
        with self.assertRaises(PermissionError):
            service.save(connection, STAFF, {})
        connection.execute.assert_not_called()
        with self.assertRaises(PermissionError):
            service.read(connection, None)
        connection.execute.assert_not_called()
        original = self.request()
        for flags in (None, [], {}, {**original["enabled"], "cages": 0}, {**original["enabled"], "unknown": True}):
            with self.subTest(flags=flags), self.assertRaises(ValueError), self.conn:
                service.save(self.conn, ADMIN, {**original, "enabled": flags})
        for body in ({"enabled": original["enabled"]}, {**original, "expectedUpdatedAt": "stale"}):
            with self.subTest(body=body), self.assertRaises(StaleWriteError), self.conn:
                service.save(self.conn, ADMIN, body)
        self.assertEqual(self.audits(), [])
        self.assertEqual(service.read(self.conn, ADMIN)["enabled"], original["enabled"])

    def test_audit_failure_rolls_back_configuration_with_the_transaction(self):
        before = service.read(self.conn, ADMIN)
        with patch.object(service, "write_audit_events", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaises(RuntimeError), self.conn:
                service.save(self.conn, ADMIN, self.request(billing=False))
        self.assertEqual(service.read(self.conn, ADMIN), before)
        self.assertEqual(self.audits(), [])

    def test_two_connections_reject_stale_edits_without_overwriting_the_other_admin(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "copy.sqlite"
            with closing(sqlite3.connect(path)) as first, closing(sqlite3.connect(path)) as second:
                self.conn.backup(first)
                first.row_factory = second.row_factory = sqlite3.Row
                stale = service.read(second, ADMIN)
                with first:
                    saved = service.save(
                        first,
                        ADMIN,
                        {"enabled": {**stale["enabled"], "cages": False}, "expectedUpdatedAt": stale["updatedAt"]},
                    )
                with self.assertRaises(StaleWriteError), second:
                    service.save(
                        second,
                        ADMIN,
                        {"enabled": {**stale["enabled"], "quarantine": False}, "expectedUpdatedAt": stale["updatedAt"]},
                    )
                self.assertEqual(service.read(second, ADMIN), saved)
                self.assertEqual(
                    first.execute(
                        "SELECT COUNT(*) FROM audit_events WHERE action='system_features.updated'"
                    ).fetchone()[0],
                    1,
                )

    def test_legacy_full_state_replacement_preserves_independent_feature_settings(self):
        with self.conn:
            hidden = service.save(self.conn, ADMIN, self.request(intake=False))
        state = copy.deepcopy(assemble_state(self.conn) or empty_state())
        with self.conn:
            write_normalized_state(self.conn, state, "2026-10-15T00:00:00Z")
        self.assertEqual(service.read(self.conn, ADMIN), hidden)

    def test_http_boundary_authentication_and_conflict_codes(self):
        handler = Mock()
        handler.require_user.return_value = None
        with patch.object(web, "connect_db") as connect:
            self.assertTrue(web.handle(handler, "GET", "/api/system/features"))
            connect.assert_not_called()
        handler.require_user.return_value = STAFF
        with patch.object(web, "connect_db") as connect:
            web.handle(handler, "PUT", "/api/system/features")
            connect.assert_not_called()
        self.assertEqual(handler.send_json.call_args.args[1], 403)
        handler.require_user.return_value = ADMIN
        handler.read_json_body.return_value = self.request()
        with (
            patch.object(web, "connect_db") as connect,
            patch.object(service, "save", side_effect=StaleWriteError("stale")),
        ):
            connect.return_value.__enter__.return_value = self.conn
            web.handle(handler, "PUT", "/api/system/features")
        self.assertEqual(handler.send_json.call_args.args[1], 409)


if __name__ == "__main__":
    unittest.main()
