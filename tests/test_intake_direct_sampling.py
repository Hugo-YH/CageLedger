import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server_app import composition
from server_app.domains.intake.service import confirm_intake_receipt
from server_app.domains.state import commands, intake_commands
from server_app.domains.state.entity_mutations import (
    ensure_intake_batch_card_qr_ids,
    normalize_intake_batches_for_state_write,
    reconcile_intake_batch_update,
)
from server_app.domains.state.entity_rules import empty_state, validate_entity_payload, validate_entity_references
from server_app.persistence.bootstrap import initialize_schema
from server_app.repositories.audit_storage import read_payload
from server_app.shared.concurrency import StaleWriteError
from server_app.shared.sqlite import ClosingConnection


def direct_batch(**changes):
    return {
        "id": "direct-1",
        "supplier": "供应商",
        "iacuc": "Z2026001",
        "pi": "负责人",
        "owner": "实验负责人",
        "quantity": 4,
        "intakeDate": "2026-10-21",
        "intakePurpose": "direct_sampling",
        "status": "pending_receipt",
        **changes,
    }


class DirectSamplingIntakeTests(unittest.TestCase):
    def test_generic_task_and_occupancy_writes_cannot_attach_to_direct_batch(self):
        state = {
            **empty_state(),
            "intakeBatches": [direct_batch()],
            "placementTasks": [{"id": "old-task", "sourceBatchId": "direct-1"}],
        }
        for collection, item in [
            ("placementTasks", {"sourceBatchId": "direct-1"}),
            ("occupancies", {"sourceBatchId": "direct-1"}),
            ("occupancies", {"placementTaskId": "old-task"}),
        ]:
            with self.subTest(collection=collection, item=item), self.assertRaisesRegex(ValueError, "直接取材"):
                validate_entity_references(state, collection, item)

    def test_legacy_snapshot_preserves_incomplete_housing_batches_without_backfill(self):
        old = {**empty_state(), "intakeBatches": [{"id": "legacy", "batchNo": "old"}]}
        result = normalize_intake_batches_for_state_write(
            old, {**old, "intakeBatches": [dict(old["intakeBatches"][0])]}
        )
        self.assertEqual(result["intakeBatches"], old["intakeBatches"])

    def test_conversion_to_housing_requires_its_own_status(self):
        with self.assertRaisesRegex(ValueError, "普通饲养"):
            reconcile_intake_batch_update(
                empty_state(), direct_batch(), direct_batch(intakePurpose="housing", roomName="8101")
            )

    def test_direct_batch_drops_housing_only_data_and_never_assigns_qr(self):
        batch = ensure_intake_batch_card_qr_ids(
            empty_state(),
            direct_batch(
                roomName="8101", endDate="2026-11-01", husbandryDays=11, finalCardCount=2, cards=[{"qrId": "X"}]
            ),
        )
        self.assertEqual(batch["roomName"], "")
        self.assertEqual(batch["cards"], [])
        self.assertEqual(batch["finalCardCount"], 0)
        self.assertIsNone(batch["husbandryDays"])

    def test_direct_confirmation_is_idempotent_and_creates_no_tasks(self):
        state = {**empty_state(), "intakeBatches": [direct_batch()]}
        deps = {
            "clean_text": str.strip,
            "new_id": lambda prefix: f"{prefix}-1",
            "now_iso": lambda: "2026-10-21T08:00:00Z",
        }
        batch, receipt, tasks = confirm_intake_receipt(
            state, "direct-1", {"actualReceiptDate": "2026-10-21"}, {"displayName": "管理员"}, deps
        )
        self.assertEqual(batch["status"], "received")
        self.assertEqual(receipt["confirmedBy"], "管理员")
        self.assertEqual(tasks, [])
        again, same_receipt, again_tasks = confirm_intake_receipt(
            state, "direct-1", {"actualReceiptDate": "2026-10-21"}, {"displayName": "管理员"}, deps
        )
        self.assertEqual(again, batch)
        self.assertEqual(same_receipt, receipt)
        self.assertEqual(again_tasks, [])

    def test_direct_requires_positive_quantity_but_not_room(self):
        validate_entity_payload("intakeBatches", direct_batch())
        for quantity in (0, 1.5, True, "1.5"):
            with self.subTest(quantity=quantity), self.assertRaisesRegex(ValueError, "动物数量"):
                validate_entity_payload("intakeBatches", direct_batch(quantity=quantity))

    def test_direct_rejects_print_and_unknown_statuses(self):
        for status in ("printed", "pending_print", "unexpected"):
            with self.subTest(status=status), self.assertRaisesRegex(ValueError, "直接取材批次状态"):
                validate_entity_payload("intakeBatches", direct_batch(status=status))

    def test_new_housing_batch_rejects_direct_only_pending_receipt_status(self):
        from server_app.domains.state.entity_rules import normalize_entity_payload

        with self.assertRaisesRegex(ValueError, "普通饲养"):
            normalize_entity_payload(
                "intakeBatches",
                {"item": {**direct_batch(intakePurpose="housing", roomName="8101")}},
                None,
                "POST",
                "batch",
                lambda _: "batch-1",
            )

    def test_purpose_conversion_rejects_historical_relations(self):
        state = {**empty_state(), "placementTasks": [{"sourceBatchId": "direct-1"}]}
        with self.assertRaisesRegex(ValueError, "不能转换"):
            reconcile_intake_batch_update(state, direct_batch(intakePurpose="housing", roomName="8101"), direct_batch())


class DirectSamplingIntakePersistenceTests(unittest.TestCase):
    def test_old_client_edit_preserves_direct_purpose_and_cannot_forge_received(self):
        saved, _ = composition.write_intake_batch_entity_state(
            "POST", None, {"item": direct_batch()}, self.actor, {"id_prefix": "batch"}
        )
        item = dict(saved["item"])
        item.pop("intakePurpose")
        item["owner"] = "新实验负责人"
        edited, _ = composition.write_intake_batch_entity_state(
            "PUT",
            item["id"],
            {"item": item, "expectedUpdatedAt": saved["item"]["updatedAt"]},
            self.actor,
            {"id_prefix": "batch"},
        )
        self.assertEqual(edited["item"]["intakePurpose"], "direct_sampling")
        self.assertEqual(edited["item"]["cards"], [])
        item = {**edited["item"], "status": "received"}
        with self.assertRaisesRegex(ValueError, "确认接收"):
            composition.write_intake_batch_entity_state(
                "PUT",
                item["id"],
                {"item": item, "expectedUpdatedAt": edited["item"]["updatedAt"]},
                self.actor,
                {"id_prefix": "batch"},
            )

    def test_mixed_batch_print_and_receipt_preserve_purposes_and_are_idempotent(self):
        for item in [
            direct_batch(),
            direct_batch(
                id="housing-1", intakePurpose="housing", roomName="8101", status="pending_print", finalCardCount=1
            ),
        ]:
            composition.write_intake_batch_entity_state(
                "POST", None, {"item": item}, self.actor, {"id_prefix": "batch"}
            )
        ids = ["direct-1", "housing-1"]
        marked = composition.persist_intake_batches_mark_printed({"ids": ids}, self.actor)
        self.assertEqual([item["id"] for item in marked["items"]], ["housing-1"])
        confirmed = composition.persist_intake_receipt_confirmations({"ids": ids}, self.actor)
        self.assertEqual({item["id"] for item in confirmed["batches"]}, set(ids))
        self.assertEqual(confirmed["receipts"], [])
        self.assertTrue(all(not item.get("receipts") for item in confirmed["batches"]))
        self.assertEqual(confirmed["tasks"], [])
        with self.connect() as conn:
            audit_count = conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0]
        self.assertEqual(composition.persist_intake_receipt_confirmations({"ids": ids}, self.actor)["batches"], [])
        with self.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0], audit_count)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM placement_tasks").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM occupancies").fetchone()[0], 0)

    actor = {"id": "admin", "username": "admin", "displayName": "管理员", "role": "admin", "roomIds": []}

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "intake.sqlite"
        with self.connect() as conn:
            initialize_schema(conn)
        self.patcher = patch.object(intake_commands, "connect_db", self.connect)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.state_patcher = patch.object(commands, "connect_db", self.connect)
        self.state_patcher.start()
        self.addCleanup(self.state_patcher.stop)

    def connect(self):
        conn = sqlite3.connect(self.path, factory=ClosingConnection)
        conn.row_factory = sqlite3.Row
        return conn

    def bulk_receipt_batches(self):
        for item in (
            direct_batch(),
            direct_batch(
                id="housing-1", intakePurpose="housing", roomName="8101", status="pending_print", finalCardCount=3
            ),
        ):
            composition.write_intake_batch_entity_state(
                "POST", None, {"item": item}, self.actor, {"id_prefix": "batch"}
            )
        composition.persist_intake_batches_mark_printed({"ids": ["housing-1"]}, self.actor)
        return self.stored_batches()

    def stored_batches(self):
        with self.connect() as conn:
            return {
                row["id"]: json.loads(row["payload"])
                for row in conn.execute("SELECT id,payload FROM intake_batches ORDER BY id")
            }

    def database_snapshot(self):
        with self.connect() as conn:
            tables = [
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
            ]
            return {table: [tuple(row) for row in conn.execute(f'SELECT * FROM "{table}"')] for table in tables}

    def bulk_receipt_body(self, batches):
        return {
            "ids": ["direct-1", "housing-1"],
            "actualReceiptDates": {"direct-1": "2026-11-02", "housing-1": "2026-11-03"},
            "expectedVersions": {identity: item["updatedAt"] for identity, item in batches.items()},
        }

    def test_bulk_actual_dates_save_and_audit_both_purposes_without_other_business_changes(self):
        before_batches = self.bulk_receipt_batches()
        before_database = self.database_snapshot()
        body = self.bulk_receipt_body(before_batches)
        result = composition.persist_intake_receipt_confirmations(body, self.actor)
        after_batches = self.stored_batches()
        self.assertEqual(len(result["receipts"]), 2)
        self.assertEqual(len({receipt["id"] for receipt in result["receipts"]}), 2)
        self.assertEqual(result["tasks"], [])
        for identity, batch in after_batches.items():
            self.assertEqual(batch["status"], "received")
            self.assertEqual(batch["updatedAt"], result["updatedAt"])
            self.assertEqual(len(batch["receipts"]), 1)
            receipt = batch["receipts"][0]
            self.assertIn(receipt, result["receipts"])
            self.assertTrue(receipt["id"].startswith("receipt-"))
            self.assertEqual(receipt["actualReceiptDate"], body["actualReceiptDates"][identity])
            self.assertEqual(receipt["confirmedBy"], self.actor["displayName"])
            self.assertEqual(receipt["confirmedAt"], result["updatedAt"])
            self.assertNotIn("cardCount", receipt)
            changed_keys = {"status", "updatedAt", "receipts"}
            self.assertEqual(
                {key: value for key, value in before_batches[identity].items() if key not in changed_keys},
                {key: value for key, value in batch.items() if key not in changed_keys},
            )
        for table, rows in self.database_snapshot().items():
            if table not in {"intake_batches", "audit_events", "audit_event_payload_blocks"}:
                self.assertEqual(rows, before_database[table], table)
        self.assertEqual(len(result["auditLogs"]), 2)
        with self.connect() as conn:
            for event in result["auditLogs"]:
                audit = json.loads(read_payload(conn, event["id"]))
                identity = audit["entityId"]
                self.assertEqual(audit["actorUserId"], self.actor["id"])
                self.assertEqual(audit["before"], before_batches[identity])
                self.assertEqual(audit["after"], after_batches[identity])

    def test_bulk_invalid_dates_reject_the_entire_request_without_writes(self):
        batches = self.bulk_receipt_batches()
        body = self.bulk_receipt_body(batches)
        before = self.database_snapshot()
        invalid_maps = [None, [], "2026-11-02", {}, {"direct-1": "2026-11-02"}]
        invalid_maps.append({**body["actualReceiptDates"], "extra": "2026-11-02"})
        for value in (
            None,
            20261103,
            True,
            "",
            "20261103",
            "2026-W45-2",
            "2026-11-3",
            "2026-02-29",
            "2026-11-31",
            "2026-11-03T00:00:00Z",
            " 2026-11-03",
        ):
            invalid_maps.append({**body["actualReceiptDates"], "housing-1": value})
        for dates in invalid_maps:
            with self.subTest(dates=dates), self.assertRaisesRegex(ValueError, "实际接收日期"):
                composition.persist_intake_receipt_confirmations({**body, "actualReceiptDates": dates}, self.actor)
            self.assertEqual(self.database_snapshot(), before)

    def test_bulk_versions_are_complete_and_exact_and_conflicts_write_nothing(self):
        batches = self.bulk_receipt_batches()
        body = self.bulk_receipt_body(batches)
        before = self.database_snapshot()
        for versions in (
            None,
            [],
            {},
            {"direct-1": batches["direct-1"]["updatedAt"]},
            {**body["expectedVersions"], "extra": "v1"},
            {**body["expectedVersions"], "housing-1": None},
        ):
            with self.subTest(versions=versions), self.assertRaisesRegex(ValueError, "版本"):
                composition.persist_intake_receipt_confirmations({**body, "expectedVersions": versions}, self.actor)
            self.assertEqual(self.database_snapshot(), before)
        for version in ("old", "", f" {batches['housing-1']['updatedAt']}"):
            with self.subTest(version=version), self.assertRaises(StaleWriteError):
                composition.persist_intake_receipt_confirmations(
                    {**body, "expectedVersions": {**body["expectedVersions"], "housing-1": version}}, self.actor
                )
            self.assertEqual(self.database_snapshot(), before)
        edited = {**batches["housing-1"], "owner": "并发修改的实验负责人"}
        composition.write_intake_batch_entity_state(
            "PUT",
            edited["id"],
            {"item": edited, "expectedUpdatedAt": batches["housing-1"]["updatedAt"]},
            self.actor,
            {"id_prefix": "batch"},
        )
        before_conflict = self.database_snapshot()
        with self.assertRaises(StaleWriteError):
            composition.persist_intake_receipt_confirmations(body, self.actor)
        self.assertEqual(self.database_snapshot(), before_conflict)

    def test_bulk_dates_without_versions_only_update_eligible_batches(self):
        self.bulk_receipt_batches()
        for item in (
            direct_batch(id="direct-draft", status="draft"),
            direct_batch(id="housing-unprinted", intakePurpose="housing", roomName="8101", status="pending_print"),
        ):
            composition.write_intake_batch_entity_state(
                "POST", None, {"item": item}, self.actor, {"id_prefix": "batch"}
            )
        before = self.stored_batches()
        room_manager = {**self.actor, "role": "room_admin", "roomIds": []}
        result = composition.persist_intake_receipt_confirmations(
            {"ids": list(before), "actualReceiptDates": dict.fromkeys(before, "2026-11-02")}, room_manager
        )
        self.assertEqual({batch["id"] for batch in result["batches"]}, {"direct-1", "housing-1"})
        self.assertEqual(len(result["receipts"]), 2)
        after = self.stored_batches()
        for identity in ("direct-draft", "housing-unprinted"):
            self.assertEqual(after[identity], before[identity])

    def test_bulk_repeated_received_batches_never_append_receipts_or_audits(self):
        body = self.bulk_receipt_body(self.bulk_receipt_batches())
        composition.persist_intake_receipt_confirmations(body, self.actor)
        repeated = self.bulk_receipt_body(self.stored_batches())
        before_repeat = self.database_snapshot()
        for request in (
            repeated,
            {"ids": repeated["ids"], "actualReceiptDates": {identity: "2026-11-04" for identity in repeated["ids"]}},
            {"ids": repeated["ids"]},
        ):
            result = composition.persist_intake_receipt_confirmations(request, self.actor)
            self.assertEqual(result["batches"], [])
            self.assertEqual(result["receipts"], [])
            self.assertEqual(result["auditLogs"], [])
            self.assertEqual(self.database_snapshot(), before_repeat)

    def test_bulk_existing_matching_dates_are_reused_without_duplicate_receipts(self):
        batches = self.bulk_receipt_batches()
        body = self.bulk_receipt_body(batches)
        with self.connect() as conn:
            for identity, batch in batches.items():
                batch["receipts"] = [
                    {"id": f"existing-{identity}", "actualReceiptDate": body["actualReceiptDates"][identity]}
                ]
                intake_commands.upsert_intake_batch_repository(conn, batch)
        result = composition.persist_intake_receipt_confirmations(body, self.actor)
        self.assertEqual(len(result["batches"]), 2)
        self.assertEqual(result["receipts"], [])
        for identity, batch in self.stored_batches().items():
            self.assertEqual(batch["receipts"], batches[identity]["receipts"])
            self.assertEqual(batch["status"], "received")

    def many_direct_batches(self):
        batches = {
            f"direct-{index:03d}": direct_batch(
                id=f"direct-{index:03d}", batchNo=f"B-{index:03d}", receipts=[], updatedAt="before-receipt"
            )
            for index in range(101)
        }
        with self.connect() as conn:
            for batch in batches.values():
                intake_commands.upsert_intake_batch_repository(conn, batch)
        return batches

    def test_bulk_actual_dates_over_one_hundred_persist_every_date_and_full_audit(self):
        before = self.many_direct_batches()
        dates = {identity: f"2026-11-{index % 2 + 1:02d}" for index, identity in enumerate(before)}
        result = composition.persist_intake_receipt_confirmations(
            {
                "ids": list(before),
                "actualReceiptDates": dates,
                "expectedVersions": {identity: batch["updatedAt"] for identity, batch in before.items()},
            },
            self.actor,
        )
        after = self.stored_batches()
        self.assertEqual(len(after), 101)
        self.assertEqual(len(result["receipts"]), 101)
        for identity, batch in after.items():
            self.assertEqual(batch["status"], "received")
            self.assertEqual(len(batch["receipts"]), 1)
            self.assertEqual(batch["receipts"][0]["actualReceiptDate"], dates[identity])
        with self.connect() as conn:
            audit_rows = conn.execute(
                "SELECT id,entity_id FROM audit_events WHERE entity_type='intake_batch'"
            ).fetchall()
            self.assertEqual(len(audit_rows), 101)
            self.assertEqual({row["entity_id"] for row in audit_rows}, set(before))
            for row in audit_rows:
                audit = json.loads(read_payload(conn, row["id"]))
                self.assertEqual(audit["before"], before[row["entity_id"]])
                self.assertEqual(audit["after"], after[row["entity_id"]])

    def test_legacy_bulk_over_one_hundred_keeps_its_existing_audit_limit(self):
        before = self.many_direct_batches()
        composition.persist_intake_receipt_confirmations({"ids": list(before)}, self.actor)
        for batch in self.stored_batches().values():
            self.assertEqual(batch["status"], "received")
            self.assertEqual(batch["receipts"], [])
        with self.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0], 100)

    def test_isolated_sqlite_confirmation_audits_without_cards_or_tasks(self):
        created, _ = composition.write_intake_batch_entity_state(
            "POST", None, {"item": direct_batch()}, self.actor, {"id_prefix": "batch"}
        )
        result = composition.persist_intake_receipt_confirmation(
            created["item"]["id"], {"actualReceiptDate": "2026-10-21"}, self.actor
        )
        self.assertEqual(result["tasks"], [])
        with self.connect() as conn:
            payload = json.loads(conn.execute("SELECT payload FROM intake_batches").fetchone()[0])
            self.assertEqual(payload["status"], "received")
            self.assertEqual(payload["cards"], [])
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM placement_tasks").fetchone()[0], 0)
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM audit_events WHERE entity_type='intake_batch'").fetchone()[0], 2
            )

    def test_confirmation_rejects_invalid_actual_date(self):
        created, _ = composition.write_intake_batch_entity_state(
            "POST", None, {"item": direct_batch()}, self.actor, {"id_prefix": "batch"}
        )
        with self.assertRaisesRegex(ValueError, "实际接收日期不能为空"):
            composition.persist_intake_receipt_confirmation(created["item"]["id"], {}, self.actor)
        with self.assertRaisesRegex(ValueError, "实际接收日期无效"):
            composition.persist_intake_receipt_confirmation(
                created["item"]["id"], {"actualReceiptDate": "2026-02-30"}, self.actor
            )

    def test_full_state_write_rejects_direct_received_and_task_bypasses(self):
        with self.assertRaisesRegex(ValueError, "确认接收"):
            commands.write_state({**empty_state(), "intakeBatches": [direct_batch(status="received")]}, self.actor)
        with self.assertRaisesRegex(ValueError, "待进驻任务"):
            commands.write_state(
                {
                    **empty_state(),
                    "intakeBatches": [direct_batch()],
                    "placementTasks": [{"id": "task", "sourceBatchId": "direct-1"}],
                },
                self.actor,
            )

    def test_room_manager_keeps_existing_intake_save_authorization_and_audit(self):
        room_manager = {
            **self.actor,
            "id": "room-manager",
            "username": "room-manager",
            "role": "room_admin",
            "roomIds": ["room-1"],
        }
        saved, _ = composition.write_intake_batch_entity_state(
            "POST", None, {"item": direct_batch()}, room_manager, {"id_prefix": "batch"}
        )
        self.assertEqual(saved["item"]["status"], "pending_receipt")
        with self.connect() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM audit_events WHERE entity_type='intake_batch'").fetchone()[0], 1
            )


if __name__ == "__main__":
    unittest.main()
