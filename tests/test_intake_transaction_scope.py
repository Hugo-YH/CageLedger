"""Local intake transactions preserve legacy decisions without loading unrelated payloads."""

import json
import sqlite3
import unittest
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

from server_app.domains.intake.rules import collect_cage_card_qr_ids, encode_cage_card_sequence, is_cage_card_qr_id
from server_app.domains.state import intake_commands
from server_app.domains.state.persistence import assemble_state
from server_app.persistence.indexes import create_performance_indexes
from server_app.repositories.audit_storage import read_payload
from server_app.repositories.entities import upsert_intake_batch, upsert_placement_task
from server_app.repositories.intake_transactions import read_intake_context, reserved_card_qr_ids
from tests import test_intake_duplicates as fixtures


class IntakeTransactionScopeTests(unittest.TestCase):
    connect = fixtures.IntakeDuplicateTests.connect
    save = fixtures.IntakeDuplicateTests.save
    counts = fixtures.IntakeDuplicateTests.counts

    def setUp(self):
        with patch("server_app.persistence.bootstrap.ensure_seed_images"):
            fixtures.IntakeDuplicateTests.setUp(self)
        with self.connect() as conn:
            for identity in ("a", "b"):
                room = {"id": identity, "name": identity}
                conn.execute("INSERT INTO rooms(id,name,payload) VALUES(?,?,?)", (identity, identity, json.dumps(room)))
            for identity, code in (("target", 1), ("unrelated", 2)):
                upsert_intake_batch(
                    conn,
                    fixtures.batch(
                        identity,
                        batchNo=identity,
                        roomName="a",
                        updatedAt="old",
                        cards=[{"qrId": encode_cage_card_sequence(code)}],
                    ),
                )
            for identity, batch, room, code in (("own-task", "target", "a", 3), ("other-task", "unrelated", "b", 4)):
                upsert_placement_task(
                    conn,
                    {
                        "id": identity,
                        "sourceBatchId": batch,
                        "sourceReceiptId": "receipt",
                        "targetRoomId": room,
                        "plannedMoveInDate": "2026-11-01",
                        "status": "pending",
                        "qrId": encode_cage_card_sequence(code),
                        "updatedAt": "old",
                    },
                )
            for identity, task, source, code in (
                ("own-occ", "own-task", "target", 5),
                ("other-occ", "other-task", "unrelated", 6),
                ("unlinked-own-occ", "", "target", 7),
            ):
                payload = {
                    "id": identity,
                    "placementTaskId": task,
                    "sourceBatchId": source,
                    "status": "active",
                    "qrId": encode_cage_card_sequence(code),
                }
                conn.execute(
                    "INSERT INTO occupancies(id,status,payload) VALUES(?,?,?)",
                    (identity, "active", json.dumps(payload)),
                )

    def snapshot(self):
        with self.connect() as conn:
            records = {
                table: [tuple(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY rowid")]
                for table in ("intake_batches", "placement_tasks", "occupancies", "intake_identifier_members")
            }
            audits = []
            for row in conn.execute("SELECT id FROM audit_events ORDER BY rowid"):
                event = json.loads(read_payload(conn, row[0]))
                event.pop("id", None)
                audits.append(event)
            return records, audits

    def target(self):
        with self.connect() as conn:
            return json.loads(conn.execute("SELECT payload FROM intake_batches WHERE id='target'").fetchone()[0])

    def test_context_is_bounded_but_global_qr_reservations_match_original_collector(self):
        with self.connect() as conn:
            statements = []
            conn.set_trace_callback(statements.append)
            context = read_intake_context(conn, ["target"])
            self.assertEqual([row["id"] for row in context["intakeBatches"]], ["target"])
            self.assertEqual([row["id"] for row in context["placementTasks"]], ["own-task"])
            self.assertEqual({row["id"] for row in context["occupancies"]}, {"own-occ", "unlinked-own-occ"})
            self.assertNotIn("auditLogs", context)
            self.assertFalse(
                any(
                    table in query.lower()
                    for query in statements
                    for table in ("billing_rules", "billing_adjustments", "audit_logs", "cage_slots")
                )
            )
            original = collect_cage_card_qr_ids(assemble_state(conn), "target")
            actual = {
                str(value).strip().upper()
                for value in reserved_card_qr_ids(conn, "target")
                if is_cage_card_qr_id(value)
            }
            self.assertEqual(actual, original)

    def test_context_associations_use_indexes_and_index_setup_is_idempotent(self):
        with self.connect() as conn:
            changes = conn.total_changes
            create_performance_indexes(conn)
            create_performance_indexes(conn)
            self.assertEqual(conn.total_changes, changes)
            statements = []
            conn.set_trace_callback(statements.append)
            context = read_intake_context(conn, ["target"])
            conn.set_trace_callback(None)
            self.assertEqual([item["id"] for item in context["placementTasks"]], ["own-task"])
            self.assertEqual({item["id"] for item in context["occupancies"]}, {"own-occ", "unlinked-own-occ"})
            for table in ("placement_tasks", "occupancies"):
                query = next(query for query in statements if f"FROM {table} WHERE" in query)
                plan = [row[3] for row in conn.execute("EXPLAIN QUERY PLAN " + query)]
                self.assertTrue(any(f"SEARCH {table} " in item for item in plan), plan)
                self.assertFalse(any(f"SCAN {table} " in item for item in plan), plan)

    def test_qr_allocation_does_not_reuse_unrelated_codes_or_change_other_rows(self):
        before = self.snapshot()[0]
        wanted = encode_cage_card_sequence(6)
        created = self.save(fixtures.batch("new", roomName="a", cards=[{"qrId": wanted}], finalCardCount=1))
        self.assertNotEqual(created["cards"][0]["qrId"], wanted)
        with self.connect() as conn:
            used = collect_cage_card_qr_ids(assemble_state(conn), "new")
            self.assertNotIn(created["cards"][0]["qrId"], used)
        after = self.snapshot()[0]
        for table in ("placement_tasks", "occupancies"):
            self.assertEqual(before[table], after[table])

    def test_task_room_permissions_and_active_task_block_are_preserved(self):
        target = self.target()
        actor = {**fixtures.ACTOR, "role": "room_admin", "roomIds": ["a"]}
        before = self.snapshot()
        with self.assertRaises(PermissionError):
            self.save({**target, "roomName": "b"}, exists=True, actor=actor)
        self.assertEqual(self.snapshot(), before)
        saved = self.save({**target, "roomName": "b"}, exists=True)
        with self.connect() as conn:
            self.assertEqual(
                conn.execute("SELECT target_room_id FROM placement_tasks WHERE id='own-task'").fetchone()[0], "b"
            )
            task = json.loads(conn.execute("SELECT payload FROM placement_tasks WHERE id='own-task'").fetchone()[0])
            upsert_placement_task(conn, {**task, "status": "active"})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, "已预留或已入驻"):
            self.save({**saved, "roomName": "a"}, exists=True)
        self.assertEqual(self.snapshot(), before)

    def test_audit_failure_rolls_back_batch_member_and_linked_task_changes(self):
        before = self.snapshot()
        with patch.object(intake_commands, "write_audit_events", side_effect=RuntimeError("audit failure")):
            with self.assertRaisesRegex(RuntimeError, "audit failure"):
                self.save({**self.target(), "roomName": "b", "purchaseOrderNo": "C2026110229486"}, exists=True)
        self.assertEqual(self.snapshot(), before)

    def test_scoped_and_legacy_context_produce_identical_business_and_audit_results(self):
        original_path = self.path
        with self.connect() as source:
            for name in ("scoped", "legacy"):
                with closing(sqlite3.connect(Path(self.directory.name) / f"{name}.sqlite")) as destination:
                    source.backup(destination)
        results = []
        for name in ("scoped", "legacy"):
            self.path = Path(self.directory.name) / f"{name}.sqlite"
            reader = read_intake_context if name == "scoped" else lambda conn, ids: assemble_state(conn)
            with (
                patch.object(intake_commands, "read_intake_context", side_effect=reader),
                patch.object(intake_commands, "datetime", wraps=datetime) as clock,
            ):
                clock.now.return_value = datetime(2026, 11, 4, tzinfo=UTC)
                self.save({**self.target(), "roomName": "b", "notes": "核对备注"}, exists=True)
            results.append(self.snapshot())
        self.path = original_path
        self.assertEqual(results[0], results[1])
