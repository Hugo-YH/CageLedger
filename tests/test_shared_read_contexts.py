"""Scoped readers preserve original matching/summary values and never write data."""

import json
import sqlite3
import unittest

from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.iacuc.rules import normalize_iacuc_number
from server_app.domains.intake.rules import cage_card_qr_id, legacy_cage_card_qr_id
from server_app.domains.state.projections import (
    public_cage_card_from_state,
    public_cage_card_payload,
    summarize_infrastructure,
)
from server_app.domains.state.query import filter_state_for_actor, read_bootstrap_state
from server_app.repositories.application_context import applications_for_iacucs
from server_app.repositories.state import assemble_state, read_applications_by_iacuc


class SharedReadContextTests(unittest.TestCase):
    def setUp(self):
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        self.conn.executescript("""
            CREATE TABLE app_settings(key TEXT,value TEXT,updated_at TEXT);
            CREATE TABLE rooms(payload);
            CREATE TABLE racks(room_id TEXT DEFAULT 'r',index_no INTEGER DEFAULT 1,payload);
            CREATE TABLE cage_slots(rack_id TEXT DEFAULT 'rack',row_no INTEGER DEFAULT 1,col_no INTEGER DEFAULT 1,payload);
            CREATE TABLE occupancies(start_date TEXT DEFAULT '2026-01-01',payload);
            CREATE TABLE placement_tasks(planned_move_in_date TEXT DEFAULT '2026-01-01',payload);
            CREATE TABLE intake_batches(updated_at TEXT DEFAULT 'v1',payload);
            CREATE TABLE experiment_applications(payload);
            CREATE TABLE billing_rules(payload);
            CREATE TABLE billing_adjustments(payload);
            CREATE TABLE audit_logs(at TEXT,payload);
        """)
        self.put("rooms", {"id": "r", "name": "Room", "defaultSpecies": "mouse", "unknown": "retained"})
        self.put("racks", {"id": "rack", "roomId": "r"})
        self.put("cage_slots", {"id": "slot", "rackId": "rack", "status": "active", "code": "A1"})
        self.batch = {
            "id": "batch",
            "batchNo": "B1",
            "iacuc": "Z1 (original)",
            "intakeDate": "2026-01-01",
            "status": "received",
            "roomName": "Room",
            "roomMatched": True,
            "quantity": 10,
            "suggestedAnimalsPerCage": 5,
            "finalCardCount": 2,
            "species": "mouse",
            "rawText": "x" * 10000,
            "cards": [{"qrId": "ABCD", "privateNote": "y" * 10000}, {"qrId": "OLD-CUSTOM"}],
        }
        self.put("intake_batches", self.batch)
        self.put(
            "placement_tasks", {"id": "first-task", "sourceBatchId": "batch", "cardSequence": 1, "qrId": "FIRST-TASK"}
        )
        self.put(
            "placement_tasks",
            {
                "id": "task",
                "sourceBatchId": "batch",
                "cardSequence": 1,
                "qrId": "TASK-CODE",
                "targetRoomId": "r",
                "reservedOccupancyId": "occupancy",
                "status": "active",
            },
        )
        self.put(
            "occupancies",
            {
                "id": "occupancy",
                "qrId": "ABCD",
                "slotId": "slot",
                "status": "active",
                "animalCount": 8,
                "startDate": "2026-01-01",
                "endDate": "",
                "iacuc": "Z1",
            },
        )
        self.put(
            "experiment_applications", {"id": "first", "iacuc": "Z1 (first)", "pi": "First PI", "funding": "Private"}
        )
        self.put("experiment_applications", {"id": "second", "iacuc": "Z1", "pi": "Second PI"})
        self.conn.execute("INSERT INTO audit_logs VALUES ('now',?)", (json.dumps({"message": "private" * 10000}),))
        self.conn.commit()

    def put(self, table, item):
        self.conn.execute(f"INSERT INTO {table}(payload) VALUES (?)", (json.dumps(item),))

    def test_public_codes_match_original_projection_without_private_aggregate_reads(self):
        state = assemble_state(self.conn)
        apps = read_applications_by_iacuc(self.conn, normalize_iacuc_number)
        before = list(self.conn.iterdump())
        codes = [
            "ABCD",
            "TASK-CODE",
            "OLD-CUSTOM",
            legacy_cage_card_qr_id(self.batch, 1),
            cage_card_qr_id(self.batch, 2),
        ]
        for code in codes:
            with self.subTest(code=code):
                expected = public_cage_card_from_state(state, apps, code.upper())
                statements = []
                self.conn.set_trace_callback(statements.append)
                actual = public_cage_card_payload(self.conn, code)
                self.conn.set_trace_callback(None)
                self.assertEqual(actual, expected)
                self.assertFalse(
                    any("audit_logs" in sql or "billing_rules" in sql or "app_settings" in sql for sql in statements)
                )
                for private in ("funding", "auditLogs", "notes", "password"):
                    self.assertNotIn(private, actual["item"])
        self.assertEqual(list(self.conn.iterdump()), before)
        with self.assertRaises(LookupError):
            public_cage_card_payload(self.conn, "MISSING")

    def test_summary_matches_full_projection_for_both_roles_without_assembly(self):
        state = assemble_state(self.conn, include_audit_logs=False)
        before = list(self.conn.iterdump())
        for actor in (
            {"role": "admin"},
            {"role": "room_admin", "roomIds": ["r"]},
            {"role": "room_admin", "roomIds": []},
        ):
            scoped = filter_state_for_actor(state, actor)
            expected = {
                "rooms": scoped["rooms"],
                "racks": scoped["racks"],
                **summarize_infrastructure(scoped),
                "slots": [],
                "occupancies": [],
            }

            def full_reader(_):
                raise AssertionError("summary must not assemble complete state")

            self.assertEqual(read_bootstrap_state(self.conn, actor, full_reader, "summary"), expected)
        self.assertEqual(list(self.conn.iterdump()), before)

    def test_target_application_first_match_retains_duplicates_blob_types_and_transactions(self):
        self.conn.execute(
            "INSERT INTO experiment_applications VALUES (?)",
            ('{"iacuc":"wrong","iacuc":"Z2","number":12345678901234567890}',),
        )
        blob = json.dumps({"iacuc": "Z3", "flag": True}).encode("utf-16")
        self.conn.execute("INSERT INTO experiment_applications VALUES (?)", (blob,))
        # A transaction-local reader must see its own changes and publish nothing.
        expected = read_applications_by_iacuc(self.conn, normalize_iacuc_number)
        result = applications_for_iacucs(self.conn, ["Z1", "Z2", "Z3", "absent"])
        self.assertEqual(result, {key: value for key, value in expected.items() if key in {"Z1", "Z2", "Z3"}})
        self.assertEqual(result["Z1"]["id"], "first")
        self.assertEqual(result["Z2"]["number"], 12345678901234567890)
        self.assertIs(result["Z3"]["flag"], True)
        self.conn.rollback()
        self.assertEqual(applications_for_iacucs(self.conn, ["Z2", "Z3"]), {})

    def test_projected_large_integer_identifiers_keep_exact_matching_and_public_code(self):
        number = 12345678901234567890
        self.put("experiment_applications", {"id": "numeric-application", "iacuc": number, "pi": "Numeric PI"})
        batch = {**self.batch, "id": number, "iacuc": number, "finalCardCount": 1, "cards": []}
        self.put("intake_batches", batch)
        expected_apps = read_applications_by_iacuc(self.conn, normalize_iacuc_number)
        self.assertEqual(applications_for_iacucs(self.conn, [str(number)]), {str(number): expected_apps[str(number)]})
        code = cage_card_qr_id(batch, 1)
        expected = public_cage_card_from_state(assemble_state(self.conn), expected_apps, code)
        self.assertEqual(public_cage_card_payload(self.conn, code), expected)
        self.assertEqual(expected["item"]["iacuc"], str(number))


if __name__ == "__main__":
    unittest.main()
