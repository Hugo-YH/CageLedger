import copy
import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from server_app import composition
from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.administration import users
from server_app.domains.animal_management import catalog_draft
from server_app.domains.iacuc import sync
from server_app.domains.quantity import application as quantity
from server_app.domains.state import commands, intake_commands, occupancy_commands, placement_commands
from server_app.domains.state.entity_rules import empty_state
from server_app.legacy import initialize_schema
from server_app.repositories.audit_storage import read_payload
from server_app.shared.concurrency import StaleWriteError, begin_write
from server_app.shared.sqlite import ClosingConnection
from server_app.web import reimbursement_actions

ACTOR = {"id": "atomic-admin", "username": "atomic-admin", "displayName": "并发测试", "role": "admin", "roomIds": []}


class LegacyWriteAtomicityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "test.sqlite"
        self.second_begin = threading.Event()
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            initialize_schema(conn)
            conn.execute(
                "INSERT INTO rooms(id,name,area,payload) VALUES('room','并发房间','测试',?)",
                (json.dumps({"id": "room", "name": "并发房间", "area": "测试"}),),
            )
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")

    def connect(self):
        conn = sqlite3.connect(self.path, factory=ClosingConnection, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")

        def trace(sql):
            if threading.current_thread().name == "second-writer" and sql == "BEGIN IMMEDIATE":
                self.second_begin.set()

        conn.set_trace_callback(trace)
        return conn

    def race(self, module, reader_name, operation, *, stale=True):
        self.second_begin.clear()
        first_read, release, second_read = threading.Event(), threading.Event(), threading.Event()
        original = getattr(module, reader_name)

        def observe(*args, **kwargs):
            result = original(*args, **kwargs)
            if threading.current_thread().name == "first-writer" and not first_read.is_set():
                first_read.set()
                if not release.wait(5):
                    raise TimeoutError("first writer was not released")
            if threading.current_thread().name == "second-writer":
                second_read.set()
            return result

        def run(name):
            threading.current_thread().name = name + "-writer"
            with self.connect() as conn:
                return operation(conn, name)

        with patch.object(module, reader_name, side_effect=observe), ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(run, "first")
            second = None
            try:
                self.assertTrue(first_read.wait(3), "first writer never reached its guarded read")
                second = pool.submit(run, "second")
                self.assertTrue(self.second_begin.wait(3), "second writer did not reserve SQLite before reading")
                self.assertFalse(second_read.wait(0.1), "second writer read an obsolete record before first committed")
            finally:
                release.set()
            first.result(timeout=5)
            if stale:
                with self.assertRaises(StaleWriteError):
                    second.result(timeout=5)
            else:
                second.result(timeout=5)
        self.assertTrue(second_read.is_set())

    def seed_sheet(self):
        with self.connect() as conn:
            return quantity.save_quantity_sheet(
                conn,
                {
                    "sheet": {
                        "id": "atomic-sheet",
                        "month": "2099-10",
                        "iacuc": "Z2099001",
                        "pi": "测试负责人",
                        "roomId": "",
                        "roomName": "",
                        "initialCageCount": 10,
                        "initialAnimalCount": 10,
                        "rows": [],
                        "owner": "original",
                    }
                },
                ACTOR,
            )[0]

    def test_quantity_two_reviewed_edits_only_one_commits_and_audits(self):
        sheet = self.seed_sheet()

        def operation(conn, name):
            return quantity.save_quantity_sheet(
                conn, {"sheet": {**sheet, "owner": name}, "expectedUpdatedAt": sheet["updatedAt"]}, ACTOR
            )

        self.race(quantity, "get_quantity_sheet_repository", operation)
        with self.connect() as conn:
            saved = json.loads(
                conn.execute("SELECT payload FROM quantity_sheets WHERE id=?", (sheet["id"],)).fetchone()[0]
            )
            self.assertEqual(saved["owner"], "first")
            events = conn.execute("SELECT id FROM audit_events WHERE action='quantity_sheet.updated'").fetchall()
            self.assertEqual(len(events), 1)
            event = json.loads(read_payload(conn, events[0][0]))
            self.assertIsNone(event["before"])  # Preserve the existing quantity audit shape.
            self.assertEqual(event["after"]["owner"], "first")

    def test_missing_quantity_versions_remain_accepted_for_legacy_callers(self):
        sheet = self.seed_sheet()
        self.race(
            quantity,
            "get_quantity_sheet_repository",
            lambda conn, name: quantity.save_quantity_sheet(conn, {"sheet": {**sheet, "owner": name}}, ACTOR),
            stale=False,
        )
        with self.connect() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM audit_events WHERE action='quantity_sheet.updated'").fetchone()[0], 2
            )

    def test_quantity_and_audit_roll_back_together(self):
        sheet = self.seed_sheet()
        with (
            self.assertRaisesRegex(RuntimeError, "audit failed"),
            patch.object(quantity, "write_audit_events", side_effect=RuntimeError("audit failed")),
        ):
            with self.connect() as conn:
                quantity.save_quantity_sheet(
                    conn,
                    {"sheet": {**sheet, "owner": "must roll back"}, "expectedUpdatedAt": sheet["updatedAt"]},
                    ACTOR,
                )
        with self.connect() as conn:
            self.assertEqual(
                json.loads(
                    conn.execute("SELECT payload FROM quantity_sheets WHERE id=?", (sheet["id"],)).fetchone()[0]
                ),
                sheet,
            )
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM audit_events WHERE action='quantity_sheet.updated'").fetchone()[0], 0
            )

    def test_user_version_is_rechecked_after_obtaining_writer(self):
        with self.connect() as conn:
            user = users.create_user(conn, {"username": "target", "password": "password", "role": "room_admin"})
        self.race(
            users,
            "get_user_by_id",
            lambda conn, name: users.update_user(
                conn, ACTOR, user["id"], {"phone": name, "expectedUpdatedAt": user["updatedAt"]}
            ),
        )
        with self.connect() as conn:
            self.assertEqual(conn.execute("SELECT phone FROM users WHERE id=?", (user["id"],)).fetchone()[0], "first")

    def test_principal_configuration_preserves_optional_version_contract(self):
        with self.connect() as conn:
            item, _ = sync.save_principal_identity(conn, {"principalType": "independent"}, ACTOR, "并发负责人")
        self.race(
            sync,
            "read_principal_identity_payloads",
            lambda conn, name: sync.save_principal_identity(
                conn, {"principalType": "independent", "expectedUpdatedAt": item["updatedAt"]}, ACTOR, "并发负责人"
            ),
        )
        with self.connect() as conn:
            sync.save_principal_identity(conn, {"principalType": "independent"}, ACTOR, "并发负责人")

    def test_catalog_draft_stale_edit_cannot_replace_newer_nodes(self):
        with self.connect() as conn:
            draft = catalog_draft.get_draft(conn)

        def operation(conn, name):
            nodes = copy.deepcopy(draft["nodes"])
            nodes[0]["name"] = name
            return catalog_draft.save_draft(
                conn,
                ACTOR,
                {"modules": draft["modules"], "nodes": nodes, "expectedUpdatedAt": draft["version"]["updatedAt"]},
            )

        self.race(catalog_draft, "_draft_row", operation)
        with self.connect() as conn:
            self.assertEqual(catalog_draft.get_draft(conn)["nodes"][0]["name"], "first")

    def test_generic_entity_edits_preserve_an_unrelated_concurrent_change(self):
        spec = {"/rules": {"collection": "billingRules", "id_prefix": "rule"}}
        with patch.object(commands, "connect_db", self.connect):
            for identity in ("a", "b"):
                commands.write_entity_state(
                    "/rules",
                    "POST",
                    None,
                    {"item": {"id": identity, "unit": "笼", "notes": "original"}},
                    ACTOR,
                    spec,
                    {},
                )
            self.race(
                commands,
                "assemble_state",
                lambda conn, name: commands.write_entity_state(
                    "/rules",
                    "PUT",
                    "a" if name == "first" else "b",
                    {"item": {"unit": "笼", "notes": name}},
                    ACTOR,
                    spec,
                    {},
                ),
                stale=False,
            )
        with self.connect() as conn:
            state = commands.assemble_state(conn)
            self.assertEqual(
                {item["id"]: item["notes"] for item in state["billingRules"]}, {"a": "first", "b": "second"}
            )

    def test_generic_entity_version_and_full_state_rollback(self):
        spec = {"/rules": {"collection": "billingRules", "id_prefix": "rule"}}
        with patch.object(commands, "connect_db", self.connect):
            created, _ = commands.write_entity_state(
                "/rules", "POST", None, {"item": {"id": "rule", "unit": "笼"}}, ACTOR, spec, {}
            )
            version = created["item"]["updatedAt"]
            self.race(
                commands,
                "assemble_state",
                lambda conn, name: commands.write_entity_state(
                    "/rules",
                    "PUT",
                    "rule",
                    {"item": {"unit": "笼", "notes": name}, "expectedUpdatedAt": version},
                    ACTOR,
                    spec,
                    {},
                ),
            )
            with self.connect() as conn:
                original = commands.assemble_state(conn)
            replacement = empty_state()
            with (
                self.assertRaisesRegex(RuntimeError, "audit failed"),
                patch.object(commands, "write_audit_events", side_effect=RuntimeError("audit failed")),
            ):
                commands.write_state(replacement, ACTOR)
            with self.connect() as conn:
                self.assertEqual(commands.assemble_state(conn), original)

    def test_begin_write_does_not_commit_an_outer_transaction(self):
        with closing(self.connect()) as conn:
            begin_write(conn)
            conn.execute("INSERT INTO audit_logs(id,message,at,payload) VALUES('pending','test','now','{}')")
            begin_write(conn)
            conn.rollback()
            self.assertIsNone(conn.execute("SELECT id FROM audit_logs WHERE id='pending'").fetchone())

    def test_batch_occupancy_and_placement_versions_are_guarded(self):
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO racks(id,room_id,name,index_no,payload) VALUES('rack','room','并发笼架',1,?)",
                (json.dumps({"id": "rack", "roomId": "room", "index": 1}),),
            )
            conn.execute(
                "INSERT INTO cage_slots(id,rack_id,row_no,col_no,status,payload) VALUES('slot','rack',1,1,'empty',?)",
                (json.dumps({"id": "slot", "rackId": "rack", "row": 1, "col": 1, "status": "empty"}),),
            )
        cases = [
            (
                intake_commands,
                "/api/intake-batches",
                {
                    "id": "batch",
                    "batchNo": "batch",
                    "iacuc": "Z2099001",
                    "pi": "测试负责人",
                    "supplier": "测试供应商",
                    "owner": "测试实验员",
                    "roomName": "并发房间",
                    "intakeDate": "2099-10-01",
                    "receipts": [{"id": "receipt", "cardCount": 0, "roomId": "room", "receiptDate": "2099-10-01"}],
                    "quantity": 1,
                    "cardCount": 0,
                    "status": "draft",
                    "cards": [],
                },
            ),
            (
                occupancy_commands,
                "/api/occupancies",
                {
                    "id": "occ",
                    "slotId": "slot",
                    "iacuc": "Z2099001",
                    "pi": "测试负责人",
                    "animalCount": 2,
                    "status": "active",
                    "startDate": "2099-10-01",
                },
            ),
            (
                placement_commands,
                "/api/placement-tasks",
                {
                    "id": "task",
                    "sourceBatchId": "batch",
                    "sourceReceiptId": "receipt",
                    "plannedRoomId": "room",
                    "iacuc": "Z2099001",
                    "pi": "测试负责人",
                    "status": "pending",
                    "plannedMoveInDate": "2099-10-01",
                },
            ),
        ]
        for module, endpoint, item in cases:
            with self.subTest(endpoint=endpoint), patch.object(module, "connect_db", self.connect):
                saved, _ = composition.write_entity_state(endpoint, "POST", None, {"item": item}, ACTOR)
                existing = saved["item"]
                self.race(
                    module,
                    "assemble_state",
                    lambda conn, name, endpoint=endpoint, item=item, existing=existing: composition.write_entity_state(
                        endpoint,
                        "PUT",
                        item["id"],
                        {"item": {**existing, "notes": name}, "expectedUpdatedAt": existing["updatedAt"]},
                        ACTOR,
                    ),
                )

    def test_cached_missing_or_old_quantity_detail_cannot_drive_a_write(self):
        from server_app.repositories.quantity_sheets import get_quantity_sheet

        with self.connect() as conn:
            self.assertIsNone(get_quantity_sheet(conn, "atomic-sheet"))
        sheet = self.seed_sheet()
        # The reader cache still says "missing". The write must update the real row.
        with self.connect() as conn:
            saved = quantity.save_quantity_sheet(
                conn, {"sheet": {**sheet, "owner": "fresh"}, "expectedUpdatedAt": sheet["updatedAt"]}, ACTOR
            )[0]
        with self.connect() as conn:
            with self.assertRaises(StaleWriteError):
                quantity.save_quantity_sheet(conn, {"sheet": sheet, "expectedUpdatedAt": sheet["updatedAt"]}, ACTOR)
            self.assertNotEqual(saved["updatedAt"], sheet["updatedAt"])

    def test_transfer_mirror_and_links_roll_back_with_failed_audit(self):
        source = self.seed_sheet()
        with self.connect() as conn:
            quantity.save_quantity_sheet(conn, {"sheet": {**source, "id": "target", "iacuc": "Z2099002"}}, ACTOR)
        with self.connect() as conn:
            before = [tuple(row) for row in conn.execute("SELECT * FROM quantity_sheets ORDER BY id")]
            audits = conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0]
        changed = {
            **source,
            "rows": [
                {
                    "id": "transfer",
                    "date": "2099-10-02",
                    "removedType": "转出",
                    "removedCount": 3,
                    "transferOutToIacuc": "Z2099002",
                }
            ],
        }
        with (
            self.assertRaisesRegex(RuntimeError, "audit failed"),
            patch.object(quantity, "write_audit_events", side_effect=RuntimeError("audit failed")),
        ):
            with self.connect() as conn:
                quantity.save_quantity_sheet(conn, {"sheet": changed, "expectedUpdatedAt": source["updatedAt"]}, ACTOR)
        with self.connect() as conn:
            self.assertEqual([tuple(row) for row in conn.execute("SELECT * FROM quantity_sheets ORDER BY id")], before)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0], audits)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM quantity_sheet_transfer_links").fetchone()[0], 0)

    def test_legacy_reimbursement_http_action_keeps_version_and_audit_atomic(self):
        from server_app.repositories.reimbursement import upsert_reimbursement_record

        with self.connect() as conn:
            upsert_reimbursement_record(
                conn,
                {
                    "id": "legacy",
                    "businessKey": "legacy",
                    "pi": "测试负责人",
                    "month": "2099-10",
                    "reimbursementStatus": "pending_submission",
                    "payableAmount": 300,
                    "updatedAt": "original",
                },
            )

        def operation(_conn, name):
            handler = reimbursement_actions.ReimbursementActionsMixin()
            handler.require_user = lambda: ACTOR
            handler.read_json_body = lambda: {"notes": name, "expectedUpdatedAt": "original"}
            output = []
            handler.send_json = lambda payload, status=200: output.append((payload, status))
            handler.handle_reimbursement_record_update("legacy")
            self.assertEqual(len(output), 1)
            if output[0][1] == 409:
                raise StaleWriteError(output[0][0]["error"])
            self.assertEqual(output[0][1], 200)

        with patch.object(reimbursement_actions, "connect_db", self.connect):
            self.race(reimbursement_actions, "get_reimbursement_record", operation)
        with self.connect() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM audit_events WHERE action='reimbursement.updated'").fetchone()[0], 1
            )


if __name__ == "__main__":
    unittest.main()
