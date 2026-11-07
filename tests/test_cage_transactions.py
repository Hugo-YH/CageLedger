"""Cage-local writes retain versions, source checks, snapshots and atomic audit."""

import copy
import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from server_app import composition
from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.cages import sync_slot_statuses
from server_app.domains.state import occupancy_commands as oc
from server_app.domains.state import placement_commands as pc
from server_app.domains.state.audit_diff import build_audit_events, validate_state_write_permission
from server_app.domains.state.occupancy import occupancy_with_snapshots
from server_app.domains.state.persistence import assemble_state, read_applications_by_iacuc
from server_app.persistence.bootstrap import initialize_schema
from server_app.repositories.audit_storage import read_payload
from server_app.repositories.cage_transactions import read_cage_context
from server_app.repositories.entities import upsert_placement_task
from server_app.repositories.infrastructure import insert_rack_record, insert_room_record, insert_slot_record
from server_app.shared.concurrency import StaleWriteError
from server_app.shared.sqlite import ClosingConnection

ADMIN = {"id": "admin", "role": "admin", "displayName": "管理员", "username": "admin", "roomIds": []}
STAFF = {**ADMIN, "id": "staff", "role": "room_admin", "roomIds": ["a"]}


class CageTransactionTests(unittest.TestCase):
    def setUp(self):
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        initialize_schema(self.conn)
        for room_id in ("a", "b"):
            insert_room_record(
                self.conn,
                {"id": room_id, "name": room_id, "defaultBillingItem": "monkey", "billingProfileManual": True},
            )
            insert_rack_record(self.conn, {"id": room_id, "roomId": room_id, "index": 1, "name": "架"})
            for number in (1, 2):
                insert_slot_record(
                    self.conn,
                    {
                        "id": room_id + str(number),
                        "rackId": room_id,
                        "row": 1,
                        "col": number,
                        "code": str(number),
                        "status": "empty",
                    },
                )
        self.original = {
            "id": "current",
            "slotId": "a1",
            "status": "active",
            "updatedAt": "version-1",
            "startDate": "2026-10-01",
            "iacuc": "Z2099001 (原文)",
            "pi": "手工负责人",
            "qrId": "persisted-animal-id",
            "animalCount": 7,
        }
        oc.upsert_occupancy_record(self.conn, self.original)
        self.conn.execute(
            "UPDATE cage_slots SET status='active',payload=json_set(payload,'$.status','active') WHERE id='a1'"
        )
        for identity, code, owner in (
            ("first", "Z2099001 (第一条)", "首条负责人"),
            ("second", "Z2099001", "后条负责人"),
            ("other", "Z2099002", "无关"),
        ):
            app = {"id": identity, "iacuc": code, "project": "项目", "funding": "项目来源", "owner": owner}
            self.conn.execute(
                "INSERT INTO experiment_applications(id,iacuc,imported_at,payload) VALUES(?,?,'2026-11-07',?)",
                (identity, code, json.dumps(app)),
            )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def write(self, method, item=None, *, identity="current", actor=ADMIN, expected="version-1"):
        payload = {"item": item or {}, "expectedUpdatedAt": expected}
        with patch.object(oc, "connect_db", return_value=self.conn):
            return composition.write_occupancy_entity_state(method, identity, payload, actor, {"id_prefix": "occ"})[0]

    def state_rows(self):
        return {
            table: [tuple(row) for row in self.conn.execute(f"SELECT * FROM {table} ORDER BY id")]
            for table in ("occupancies", "placement_tasks", "cage_slots", "audit_events", "audit_logs")
        }

    def task(self, identity="task"):
        task = {
            "id": identity,
            "status": "pending",
            "targetRoomId": "a",
            "qrId": "persisted-task-animal",
            "plannedMoveInDate": "2026-11-01",
            "iacuc": "Z2099001",
            "updatedAt": "task-version",
        }
        upsert_placement_task(self.conn, task)
        self.conn.commit()
        return task

    def reserve(self, task_id="task", slot_id="a2", actor=STAFF):
        with patch.object(pc, "connect_db", return_value=self.conn):
            return composition.persist_placement_action(
                task_id,
                actor,
                lambda state: composition.reserve_placement_task(state, task_id, slot_id, actor),
                context={"slotId": slot_id},
            )

    def test_saved_record_and_audit_match_legacy_rules_with_only_target_dependencies(self):
        item = {**self.original, "notes": "修改", "slotId": "a2"}
        full = assemble_state(self.conn)
        expected = copy.deepcopy(full)
        normalized = composition.normalize_entity_payload("occupancies", {"item": item}, "current", "PUT", "occ")
        normalized["updatedAt"] = "2026-11-07T00:00:00+00:00"
        composition.replace_entity(expected, "occupancies", "current", normalized)
        sync_slot_statuses(expected)
        validate_state_write_permission(STAFF, full, expected)
        expected_events = build_audit_events(STAFF, full, expected, normalized["updatedAt"])
        expected_saved = occupancy_with_snapshots(normalized, expected, read_applications_by_iacuc(self.conn))
        with patch.object(oc, "datetime") as clock:
            clock.now.return_value = datetime.fromisoformat(normalized["updatedAt"])
            actual = self.write("PUT", item, actor=STAFF)
        self.assertEqual(actual["item"], expected_saved)
        self.assertEqual(actual["item"]["qrId"], self.original["qrId"])
        self.assertEqual(actual["item"]["owner"], "首条负责人")
        self.assertEqual(actual["item"]["pi"], "手工负责人")
        self.assertEqual(actual["item"]["animalCount"], 7)
        self.assertEqual(actual["affectedSlots"], [slot for slot in expected["slots"] if slot["id"] in ("a1", "a2")])
        event = json.loads(read_payload(self.conn, self.conn.execute("SELECT id FROM audit_events").fetchone()[0]))
        self.assertEqual(
            {k: v for k, v in event.items() if k != "id"}, {k: v for k, v in expected_events[0].items() if k != "id"}
        )

    def test_scope_does_not_decode_unrelated_payloads_or_load_audit_history(self):
        # Valid but large unrelated business history must not be read/decoded.
        for index in range(50):
            oc.upsert_occupancy_record(
                self.conn, {"id": f"history-{index}", "slotId": "b1", "status": "ended", "notes": "无关" * 1000}
            )
        self.conn.commit()
        statements = []
        self.conn.set_trace_callback(statements.append)
        context = read_cage_context(self.conn, "occupancies", "current", self.original)
        self.write("PUT", {**self.original, "notes": "目标更新"})
        self.conn.set_trace_callback(None)
        self.assertEqual([o["id"] for o in context["occupancies"]], ["current"])
        self.assertEqual([r["id"] for r in context["rooms"]], ["a"])
        selects = [sql for sql in statements if sql.startswith("SELECT")]
        # Audit insertion can check a new event's ID; it must not read history.
        audit_reads = [sql for sql in selects if "FROM audit_logs" in sql or "FROM audit_events" in sql]
        self.assertTrue(all("WHERE id =" in sql or "WHERE id=" in sql for sql in audit_reads))
        self.assertFalse(any("SELECT payload FROM intake_batches" in sql for sql in selects))
        occupancy_plans = [
            row[3]
            for sql in selects
            if "FROM occupancies" in sql
            for row in self.conn.execute("EXPLAIN QUERY PLAN " + sql)
        ]
        self.assertFalse(any(detail.startswith("SCAN occupancies") for detail in occupancy_plans), occupancy_plans)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM occupancies").fetchone()[0], 51)

    def test_stale_unauthorized_and_audit_failure_leave_all_rows_unchanged(self):
        before = self.state_rows()
        with self.assertRaises(StaleWriteError):
            self.write("PUT", self.original, expected="old")
        with self.assertRaises(PermissionError):
            self.write("PUT", {**self.original, "slotId": "b1"}, actor=STAFF)
        with (
            self.assertRaisesRegex(RuntimeError, "audit failed"),
            patch.object(oc, "write_audit_events", side_effect=RuntimeError("audit failed")),
        ):
            self.write("PUT", {**self.original, "slotId": "a2"})
        self.assertEqual(self.state_rows(), before)
        # Omitted/blank legacy versions keep their existing compatibility.
        self.assertEqual(self.write("PUT", self.original, expected="")["item"]["id"], "current")

    def test_direct_sampling_and_inferred_task_source_are_still_rejected(self):
        self.conn.execute(
            "INSERT INTO intake_batches(id,batch_no,status,updated_at,payload) VALUES('direct','D','draft','v',?)",
            (json.dumps({"id": "direct", "intakePurpose": "direct_sampling", "cards": ["large"] * 1000}),),
        )
        upsert_placement_task(self.conn, {"id": "direct-task", "sourceBatchId": "direct", "status": "pending"})
        self.conn.commit()
        before = self.state_rows()
        for extra in ({"sourceBatchId": "direct"}, {"placementTaskId": "direct-task"}):
            with self.assertRaisesRegex(ValueError, "直接取材"):
                self.write("PUT", {**self.original, **extra})
        self.assertEqual(self.state_rows(), before)

    def test_sampling_and_clearing_keep_distinct_audits_and_slot_status(self):
        for reason, action in (("sampled", "occupancy.sampled"), ("cleared", "occupancy.cleared")):
            # Each operation ends an active occupancy, rather than editing an already ended one.
            oc.upsert_occupancy_record(self.conn, self.original)
            self.conn.commit()
            saved = self.write(
                "PUT", {**self.original, "status": "ended", "endReason": reason, "endDate": "2026-11-07"}, expected=""
            )
            self.assertEqual(saved["item"]["endReason"], reason)
            self.assertEqual(saved["affectedSlots"][0]["status"], "empty")
            self.assertEqual(
                json.loads(
                    read_payload(
                        self.conn, self.conn.execute("SELECT id FROM audit_events ORDER BY rowid DESC").fetchone()[0]
                    )
                )["action"],
                action,
            )

    def test_reserve_move_in_permissions_and_legacy_active_slot_links(self):
        self.task()
        with self.assertRaisesRegex(ValueError, "目标饲养间"):
            self.reserve(slot_id="b1")
        with self.assertRaises(PermissionError):
            self.reserve(actor={**STAFF, "roomIds": ["b"]})
        legacy = {"id": "legacy", "slotId": "a2", "status": "active"}
        self.conn.execute(
            "INSERT INTO occupancies(id,status,payload) VALUES('legacy','active',?)", (json.dumps(legacy),)
        )
        self.conn.commit()
        with self.assertRaisesRegex(ValueError, "不可用"):
            self.reserve()
        self.conn.execute("DELETE FROM occupancies WHERE id='legacy'")
        self.conn.commit()
        reserved = self.reserve()
        self.assertEqual(reserved["occupancy"]["qrId"], "persisted-task-animal")
        self.assertEqual(reserved["affectedSlots"][0]["status"], "reserved")
        with self.assertRaisesRegex(ValueError, "不可用"):
            self.reserve()
        with patch.object(pc, "connect_db", return_value=self.conn):
            moved = composition.persist_placement_action(
                "task",
                STAFF,
                lambda state: composition.move_in_placement_task(state, "task", "2026-11-07", STAFF),
                context={},
            )
        self.assertEqual(moved["occupancy"]["id"], reserved["occupancy"]["id"])
        self.assertEqual(moved["occupancy"]["qrId"], reserved["occupancy"]["qrId"])
        self.assertEqual(moved["occupancy"]["startDate"], "2026-11-07")
        self.assertEqual(moved["affectedSlots"][0]["status"], "active")

    def test_parallel_reservations_serialize_and_only_one_occupies_the_slot(self):
        self.task("task-1")
        self.task("task-2")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "race.sqlite"
            with sqlite3.connect(path, factory=ClosingConnection) as target:
                self.conn.backup(target)

            def connect():
                conn = sqlite3.connect(path, factory=ClosingConnection, timeout=5)
                conn.row_factory = sqlite3.Row
                return conn

            start = threading.Barrier(2)

            def reserve(identity):
                start.wait(timeout=5)
                try:
                    return composition.persist_placement_action(
                        identity,
                        STAFF,
                        lambda state: composition.reserve_placement_task(state, identity, "a2", STAFF),
                        context={"slotId": "a2"},
                    )
                except ValueError as error:
                    return error

            with patch.object(pc, "connect_db", side_effect=connect), ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(reserve, ("task-1", "task-2")))
            self.assertEqual(sum(isinstance(value, dict) for value in results), 1)
            self.assertEqual(sum(isinstance(value, ValueError) for value in results), 1)
            with connect() as conn:
                self.assertEqual(
                    conn.execute(
                        "SELECT COUNT(*) FROM occupancies WHERE slot_id='a2' AND status='reserved'"
                    ).fetchone()[0],
                    1,
                )
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM audit_events WHERE action='occupancy.created'").fetchone()[0], 1
                )

    def test_task_delete_releases_reserved_occupancy_but_active_task_is_protected(self):
        self.task()
        reserved = self.reserve()
        with patch.object(pc, "connect_db", return_value=self.conn):
            removed, _ = composition.write_placement_task_entity_state(
                "DELETE", "task", {}, STAFF, {"id_prefix": "task"}
            )
        self.assertEqual(removed["affectedSlots"][0]["status"], "empty")
        self.assertIsNone(
            self.conn.execute("SELECT id FROM occupancies WHERE id=?", (reserved["occupancy"]["id"],)).fetchone()
        )
        self.assertIsNotNone(self.conn.execute("SELECT id FROM occupancies WHERE id='current'").fetchone())
        self.task("active-task")
        active = {**self.task("active-task"), "status": "active"}
        upsert_placement_task(self.conn, active)
        self.conn.commit()
        before = self.state_rows()
        with patch.object(pc, "connect_db", return_value=self.conn), self.assertRaisesRegex(ValueError, "已正式入驻"):
            composition.write_placement_task_entity_state("DELETE", "active-task", {}, ADMIN, {"id_prefix": "task"})
        self.assertEqual(self.state_rows(), before)

    def test_reassign_and_action_audit_failure_keep_original_atomicity(self):
        self.task()
        before = self.state_rows()
        with (
            patch.object(pc, "write_audit_events", side_effect=RuntimeError("audit failed")),
            self.assertRaisesRegex(RuntimeError, "audit failed"),
        ):
            self.reserve()
        self.assertEqual(self.state_rows(), before)
        with patch.object(pc, "connect_db", return_value=self.conn):
            changed = composition.persist_placement_action(
                "task",
                ADMIN,
                lambda state: composition.reassign_placement_task_room(state, "task", "b", ADMIN),
                context={"roomId": "b"},
            )
        self.assertEqual(changed["task"]["targetRoomId"], "b")
        self.assertEqual(changed["task"]["targetRoomName"], "b")
        self.assertEqual(changed["task"]["qrId"], "persisted-task-animal")
        self.assertEqual(len(changed["task"]["roomChangeHistory"]), 1)
