import json
import sqlite3
import unittest
from unittest.mock import Mock, patch

from server_app.cache import invalidate_data_cache, invalidate_data_cache_prefixes
from server_app.domains.infrastructure import service
from server_app.domains.state.entity_rules import empty_state
from server_app.domains.state.persistence import assemble_state, read_cached_state, write_normalized_state
from server_app.domains.state.query import read_bootstrap_state
from server_app.persistence.bootstrap import initialize_schema
from server_app.repositories.audit_storage import read_payload
from server_app.web import infrastructure
from server_app.web.handler_support import HandlerSupportMixin
from server_app.web.router_registry import API_ROUTER

ADMIN = {"id": "admin", "username": "admin", "displayName": "管理员", "role": "admin", "roomIds": []}
LIMITED = {"id": "staff", "username": "staff", "displayName": "房间管理员", "role": "room_admin", "roomIds": ["r1"]}
NO_ROOMS = {"id": "none", "role": "room_admin", "roomIds": []}
EMPTY_LAYOUT = {"placements": [], "updatedAt": ""}
PLACEMENT = {"rackId": "rack1", "column": 0, "row": 0, "rotation": 0}


class InfrastructureReadTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
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
            self.assertTrue(infrastructure.handle(handler, "GET", "/api/infrastructure/rooms/r1"))
            self.assertEqual(handler.response[1], 403)
            handler.actor = ADMIN
            self.assertTrue(infrastructure.handle(handler, "GET", "/api/infrastructure/racks/missing/slots"))
            self.assertEqual(handler.response[1], 404)

    def test_cage_view_filters_only_unused_history_and_preserves_full_api_and_permissions(self):
        for identity, status in (("old", "ended"), ("reserved", "reserved")):
            item = {"id": identity, "slotId": "s1", "status": status, "updatedAt": "version", "notes": "完整字段"}
            self.conn.execute(
                "INSERT INTO occupancies(id,slot_id,status,start_date,payload) VALUES(?,?,?,?,?)",
                (identity, "s1", status, "2026-01-01", json.dumps(item)),
            )
        for identity, status in (("done", "active"), ("cancel", "cancelled"), ("legacy", "unknown")):
            item = {"id": identity, "targetRoomId": "r1", "status": status}
            self.conn.execute(
                "INSERT INTO placement_tasks(id,target_room_id,status,payload,source_batch_id,source_receipt_id,planned_move_in_date) VALUES(?,?,?,?,'fixture','fixture','2026-11-07')",
                (identity, "r1", status, json.dumps(item)),
            )
        self.conn.commit()
        before = self.conn.total_changes
        full = service.room_workspace(self.conn, LIMITED, "r1")
        actual = service.room_workspace(self.conn, LIMITED, "r1", view="cages")
        expected = {
            **full,
            "occupancies": [o for o in full["occupancies"] if o["status"] in ("active", "reserved")],
            "placementTasks": [t for t in full["placementTasks"] if t.get("status") not in ("active", "cancelled")],
            "rackLayout": EMPTY_LAYOUT,
        }
        self.assertEqual(actual, expected)
        self.assertEqual(self.conn.total_changes, before)
        self.assertEqual(service.room_workspace(self.conn, LIMITED, "r1"), full)
        with self.assertRaises(PermissionError):
            service.room_workspace(self.conn, NO_ROOMS, "r1", view="cages")

        class Handler:
            path = "/api/infrastructure/rooms/r1?view=cages"

            def require_user(self):
                return LIMITED

            def send_json(self, value, status=200):
                self.value, self.status = value, status

        handler = Handler()
        with patch.object(infrastructure, "connect_db", return_value=self.conn):
            self.assertTrue(infrastructure.handle(handler, "GET", "/api/infrastructure/rooms/r1"))
        self.assertEqual(handler.value, expected)

    def put_layout(self, room_id, actor, body):
        handler = HandlerSupportMixin()
        handler.require_user = Mock(return_value=actor)
        handler.read_json_body = Mock(return_value=body)
        handler.send_json = Mock()
        with patch.object(infrastructure, "connect_db", return_value=self.conn):
            self.assertTrue(API_ROUTER.handle("PUT", f"/api/infrastructure/rooms/{room_id}/rack-layout", handler))
        handler.send_json.assert_called_once()
        response, *status = handler.send_json.call_args.args
        return response, status[0] if status else 200

    def test_layout_permissions_versions_and_audit_are_scoped_to_metadata(self):
        before = assemble_state(self.conn)
        body = {"placements": [PLACEMENT], "expectedUpdatedAt": ""}
        for actor in (NO_ROOMS, {**LIMITED, "role": "researcher"}):
            self.assertEqual(self.put_layout("r1", actor, body)[1], 403)
        self.assertEqual(self.put_layout("missing", ADMIN, body)[1], 404)
        self.assertEqual(self.put_layout("r1", ADMIN, {"placements": [PLACEMENT]})[1], 400)
        self.assertEqual(self.put_layout("r1", ADMIN, {**body, "expectedUpdatedAt": "unsaved-version"})[1], 409)
        saved, status = self.put_layout("r1", LIMITED, body)
        self.assertEqual(status, 200)
        self.assertEqual(saved["placements"], body["placements"])
        self.assertTrue(saved["updatedAt"])
        self.assertEqual(self.put_layout("r1", ADMIN, body)[1], 409)
        self.assertEqual(self.put_layout("r1", ADMIN, {**body, "expectedUpdatedAt": saved["updatedAt"] + " "})[1], 409)
        self.assertEqual(service.room_workspace(self.conn, LIMITED, "r1", view="cages")["rackLayout"], saved)
        self.assertEqual(service.room_workspace(self.conn, ADMIN, "r2", view="cages")["rackLayout"], EMPTY_LAYOUT)
        self.assertNotIn("rackLayout", service.room_workspace(self.conn, LIMITED, "r1"))
        self.assertEqual(assemble_state(self.conn), before)
        audit_ids = self.conn.execute("SELECT id FROM audit_events WHERE action='rack_layout.updated'").fetchall()
        self.assertEqual(len(audit_ids), 1)
        audit = json.loads(read_payload(self.conn, audit_ids[0]["id"]))
        self.assertEqual((audit["actorUserId"], audit["entityId"]), ("staff", "r1"))
        self.assertEqual((audit["before"], audit["after"]), (EMPTY_LAYOUT, saved))

        cleared, status = self.put_layout("r1", ADMIN, {"placements": [], "expectedUpdatedAt": saved["updatedAt"]})
        self.assertEqual(status, 200)
        self.assertEqual(cleared["placements"], [])
        self.assertNotEqual(cleared["updatedAt"], saved["updatedAt"])
        self.assertEqual(self.put_layout("r1", ADMIN, {**body, "expectedUpdatedAt": saved["updatedAt"]})[1], 409)

    def test_layout_geometry_uses_rotated_extents_and_rejects_invalid_racks(self):
        self.conn.execute(
            "INSERT INTO racks(id,room_id,name,payload) VALUES('other','r1','other',?)",
            (json.dumps({"id": "other", "roomId": "r1", "name": "other"}),),
        )
        self.conn.commit()
        other = {"rackId": "other", "column": 3, "row": 1, "rotation": 90}
        for placements in (
            [PLACEMENT, other],
            [PLACEMENT, {**PLACEMENT, "column": 4}],
            [{**PLACEMENT, "rackId": "rack2"}],
            [{**PLACEMENT, "column": 253}],
            [{**other, "row": 253}],
            [{**PLACEMENT, "column": -1}],
            [{**PLACEMENT, "column": 0.0}],
            [{**PLACEMENT, "row": True}],
            [{**PLACEMENT, "rotation": False}],
            [{**PLACEMENT, "rotation": 180}],
        ):
            with self.subTest(placements=placements):
                self.assertEqual(
                    self.put_layout("r1", ADMIN, {"placements": placements, "expectedUpdatedAt": ""})[1], 400
                )
        self.assertEqual(service.room_workspace(self.conn, ADMIN, "r1", view="cages")["rackLayout"], EMPTY_LAYOUT)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0], 0)
        valid = [{**PLACEMENT, "column": 250, "row": 254}, {**other, "column": 254, "row": 252}]
        saved, status = self.put_layout("r1", ADMIN, {"placements": valid, "expectedUpdatedAt": ""})
        self.assertEqual((saved["placements"], status), (valid, 200))
        self.assertEqual(service.room_workspace(self.conn, ADMIN, "r1", view="cages")["rackLayout"], saved)

    def test_layout_persists_across_schema_and_legacy_room_rewrite_then_cascades(self):
        saved, status = self.put_layout("r1", ADMIN, {"placements": [PLACEMENT], "expectedUpdatedAt": ""})
        self.assertEqual(status, 200)
        with patch("server_app.persistence.bootstrap.ensure_seed_images"):
            initialize_schema(self.conn)
        state = assemble_state(self.conn)
        state["racks"][0]["roomId"] = "r2"
        with self.conn:
            write_normalized_state(self.conn, state, "2026-10-02")
        self.assertEqual(
            self.conn.execute("SELECT updated_at FROM room_rack_layouts WHERE room_id='r1'").fetchone()["updated_at"],
            saved["updatedAt"],
        )
        self.assertEqual(
            service.room_workspace(self.conn, ADMIN, "r1", view="cages")["rackLayout"], {**saved, "placements": []}
        )
        self.assertEqual(service.room_workspace(self.conn, ADMIN, "r2", view="cages")["rackLayout"], EMPTY_LAYOUT)
        with self.conn:
            self.conn.execute("DELETE FROM rooms WHERE id='r1'")
        self.assertIsNone(self.conn.execute("SELECT room_id FROM room_rack_layouts WHERE room_id='r1'").fetchone())

    def test_layout_rolls_back_if_audit_write_fails(self):
        with (
            patch.object(service, "write_audit_events", side_effect=RuntimeError("audit failed")),
            self.assertRaisesRegex(RuntimeError, "audit failed"),
        ):
            self.put_layout("r1", ADMIN, {"placements": [PLACEMENT], "expectedUpdatedAt": ""})
        self.assertEqual(service.room_workspace(self.conn, ADMIN, "r1", view="cages")["rackLayout"], EMPTY_LAYOUT)

    def test_bootstrap_summary_cache_hit_skips_state_assembly(self):
        state_reader = Mock(return_value=read_cached_state(self.conn))
        first = read_bootstrap_state(self.conn, ADMIN, state_reader, "summary")
        state_reader.reset_mock(side_effect=True)
        state_reader.side_effect = AssertionError("cached summary must not read state")
        self.assertEqual(read_bootstrap_state(self.conn, ADMIN, state_reader, "summary"), first)
        state_reader.assert_not_called()
