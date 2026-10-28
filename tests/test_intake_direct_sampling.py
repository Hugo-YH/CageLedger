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
