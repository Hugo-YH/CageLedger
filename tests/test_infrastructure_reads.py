import sqlite3
import unittest
from unittest.mock import Mock, patch

from server_app.cache import invalidate_data_cache, invalidate_data_cache_prefixes
from server_app.domains.infrastructure import service
from server_app.domains.state.entity_rules import empty_state
from server_app.domains.state.persistence import read_cached_state, write_normalized_state
from server_app.domains.state.query import read_bootstrap_state
from server_app.persistence.bootstrap import initialize_schema
from server_app.web import infrastructure

ADMIN = {"id": "admin", "role": "admin", "roomIds": []}
LIMITED = {"id": "staff", "role": "room_admin", "roomIds": ["r1"]}
NO_ROOMS = {"id": "none", "role": "room_admin", "roomIds": []}


class InfrastructureReadTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        with patch("server_app.persistence.bootstrap.ensure_seed_images"):
            initialize_schema(self.conn)
        state = empty_state()
        state.update(
            rooms=[{"id": "r1", "name": "8014"}, {"id": "r2", "name": "8020"}],
            racks=[
                {"id": "rack1", "roomId": "r1", "name": "架1", "index": 1, "rows": 1, "cols": 1},
                {"id": "rack2", "roomId": "r2", "name": "架2", "index": 1, "rows": 1, "cols": 1},
            ],
            slots=[
                {"id": "s1", "rackId": "rack1", "row": 1, "col": 1, "status": "active"},
                {"id": "s2", "rackId": "rack2", "row": 1, "col": 1, "status": "empty"},
            ],
            occupancies=[
                {
                    "id": "o1",
                    "slotId": "s1",
                    "rackId": "rack1",
                    "roomId": "r1",
                    "status": "active",
                    "startDate": "2026-10-01",
                }
            ],
            placementTasks=[{"id": "t1", "targetRoomId": "r1", "plannedMoveInDate": "2026-10-01", "status": "pending"}],
        )
        write_normalized_state(self.conn, state, "2026-10-01")
        self.conn.commit()
        invalidate_data_cache("assembled_state")
        invalidate_data_cache_prefixes("bootstrap_summary::")

    def tearDown(self):
        self.conn.close()
        invalidate_data_cache("assembled_state")
        invalidate_data_cache_prefixes("bootstrap_summary::")

    def test_room_workspace_matches_legacy_room_projection_for_authorized_actors(self):
        for actor in (ADMIN, LIMITED):
            with self.subTest(actor=actor["id"]):
                legacy = read_bootstrap_state(self.conn, actor, read_cached_state, "room", "r1")
                actual = service.room_workspace(self.conn, actor, "r1")
                self.assertEqual(actual["rooms"], [room for room in legacy["rooms"] if room["id"] == "r1"])
                for key in ("racks", "slots", "occupancies", "placementTasks"):
                    expected = legacy[key]
                    if key == "racks":
                        expected = [rack for rack in expected if rack["roomId"] == "r1"]
                    self.assertEqual(actual[key], expected)
                self.assertEqual(service.rack_slots(self.conn, actor, "rack1")["items"], actual["slots"])

    def test_scope_for_admin_limited_and_no_rooms_and_not_found(self):
        self.assertEqual(len(service.structure(self.conn, ADMIN)["rooms"]), 2)
        self.assertEqual([r["id"] for r in service.structure(self.conn, LIMITED)["rooms"]], ["r1"])
        self.assertEqual(service.structure(self.conn, NO_ROOMS)["rooms"], [])
        with self.assertRaises(PermissionError):
            service.room_workspace(self.conn, LIMITED, "r2")
        with self.assertRaises(PermissionError):
            service.rack_slots(self.conn, NO_ROOMS, "rack1")
        with self.assertRaises(LookupError):
            service.room_workspace(self.conn, ADMIN, "missing")
        with self.assertRaises(LookupError):
            service.rack_slots(self.conn, ADMIN, "missing")

    def test_read_only_structure_uses_counts_without_slot_or_occupancy_payloads(self):
        before = self.conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0]
        self.conn.execute("PRAGMA query_only=ON")
        sql = []
        self.conn.set_trace_callback(sql.append)
        result = service.structure(self.conn, ADMIN)
        service.room_workspace(self.conn, ADMIN, "r1")
        service.rack_slots(self.conn, ADMIN, "rack1")
        self.conn.set_trace_callback(None)
        self.assertEqual(result["rackSummaries"][0]["slotCount"], 1)
        structure_sql = sql[:3]
        self.assertFalse(any("s.payload" in query.lower() or "occupancies" in query.lower() for query in structure_sql))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0], before)

    def test_http_permission_and_missing_responses(self):
        class Handler:
            actor = NO_ROOMS
            response = None

            def require_user(self):
                return self.actor

            def send_json(self, payload, status=200):
                self.response = (payload, status)

        handler = Handler()
        with patch.object(infrastructure, "connect_db", return_value=self.conn):
            self.assertTrue(infrastructure.handle(handler, "/api/infrastructure/rooms/r1"))
            self.assertEqual(handler.response[1], 403)
            handler.actor = ADMIN
            self.assertTrue(infrastructure.handle(handler, "/api/infrastructure/racks/missing/slots"))
            self.assertEqual(handler.response[1], 404)

    def test_bootstrap_summary_cache_hit_skips_state_assembly(self):
        state_reader = Mock(return_value=read_cached_state(self.conn))
        first = read_bootstrap_state(self.conn, ADMIN, state_reader, "summary")
        state_reader.reset_mock(side_effect=True)
        state_reader.side_effect = AssertionError("cached summary must not read state")
        self.assertEqual(read_bootstrap_state(self.conn, ADMIN, state_reader, "summary"), first)
        state_reader.assert_not_called()
