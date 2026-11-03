"""Grouped procurement/demand numbers must not duplicate animals or bypass checks."""

import json
import sqlite3
import unittest
from unittest.mock import patch

from server_app.domains.intake.ai_parse import ai_parse_intake_message
from server_app.domains.intake.duplicates import IntakeDuplicateConfirmationRequired, confirm_duplicate_identifiers
from server_app.domains.intake.recognition_evidence import sanitize_evidence
from server_app.domains.intake.recognition_merge import _candidate
from server_app.domains.state.entity_rules import validate_entity_payload
from server_app.persistence.billing_schema import initialize_billing_schema
from server_app.persistence.intake_identifier_groups import ensure_intake_identifier_groups
from server_app.persistence.intake_identifiers import ensure_intake_identifier_schema
from server_app.persistence.system_schema import initialize_system_schema
from server_app.repositories.entities import (
    delete_intake_batch,
    list_intake_batch_filter_options,
    list_intake_batches_page,
    upsert_intake_batch,
)
from server_app.repositories.filter_options import filtered_where
from server_app.shared.intake_identifiers import normalize_intake_order_identifiers
from server_app.web.entity_contracts import ENTITY_ORDER_BY
from tests.test_intake_duplicates import batch

ORDERS = ["DC202609212926501", "DC202609212923401"]
PURCHASES = ["C2026092129265", "C2026092129234"]
BATCHES = ["（Z2025034）2025090302", "（Z2025034）2025090313"]


class IntakeIdentifierGroupTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        with self.conn:
            initialize_billing_schema(self.conn)
            initialize_system_schema(self.conn)
            ensure_intake_identifier_schema(self.conn)
            ensure_intake_identifier_groups(self.conn)

    def grouped(self, identity="group"):
        return batch(
            identity,
            purchaseOrderNo="、".join(ORDERS),
            batchNo="、".join(BATCHES),
            iacuc="Z2025034",
            quantity=60,
            updatedAt="old-version",
            rawMessage="完整保留原始两订单预约",
            cards=[{"id": "original-card", "qrId": "ABCD"}],
            receipts=[],
            recognition={"extractedText": "原图文字", "sources": []},
        )

    def item(self, identity="group"):
        return json.loads(self.conn.execute("SELECT payload FROM intake_batches WHERE id=?", (identity,)).fetchone()[0])

    def test_group_classifies_orders_and_demands_without_splitting_total_or_originals(self):
        original = self.grouped()
        item = normalize_intake_order_identifiers(original)
        self.assertEqual(item["identifiers"], {"purchaseOrderNos": PURCHASES, "orderNos": ORDERS, "batchNos": BATCHES})
        self.assertEqual(item["quantity"], 60)
        for field in ("cards", "receipts", "rawMessage", "recognition", "iacuc"):
            self.assertEqual(item[field], original[field])
        self.assertEqual(item, normalize_intake_order_identifiers(item))
        self.assertEqual(original["purchaseOrderNo"], "、".join(ORDERS))

    def test_array_only_input_and_legacy_edit_cannot_restore_stale_members(self):
        normalized = normalize_intake_order_identifiers(
            {"identifiers": {"purchaseOrderNos": PURCHASES, "orderNos": ORDERS, "batchNos": BATCHES}}
        )
        self.assertEqual(normalized["orderNo"], "、".join(ORDERS))
        cleared = normalize_intake_order_identifiers(
            {**normalized, "purchaseOrderNo": "", "orderNo": "", "batchNo": BATCHES[0]}
        )
        self.assertEqual(cleared["identifiers"], {"purchaseOrderNos": [], "orderNos": [], "batchNos": [BATCHES[0]]})
        with self.assertRaises(ValueError):
            normalize_intake_order_identifiers({"identifiers": {"orderNos": [f"X{index}" for index in range(51)]}})

    def test_each_member_triggers_confirmation_and_confirmed_cross_record_relations_are_allowed(self):
        with self.conn:
            upsert_intake_batch(self.conn, self.grouped())
        for index, fields in enumerate(
            (
                {"purchaseOrderNo": PURCHASES[1]},
                {"purchaseOrderNo": "new", "orderNo": ORDERS[1]},
                {"purchaseOrderNo": "new", "batchNo": BATCHES[1]},
            )
        ):
            incoming = batch(
                "new-" + str(index),
                batchNo="separate-" + str(index),
                **{k: v for k, v in fields.items() if k != "batchNo"},
            )
            if "batchNo" in fields:
                incoming["batchNo"] = fields["batchNo"]
            if "orderNo" in fields:
                incoming["purchaseOrderNo"] = ""
            before = self.conn.total_changes
            with self.assertRaises(IntakeDuplicateConfirmationRequired) as caught:
                confirm_duplicate_identifiers(self.conn, incoming, "", None)
            self.assertEqual(self.conn.total_changes, before)
            details = caught.exception.details
            self.assertEqual(details["total"], 1)
            self.assertEqual(details["items"][0]["id"], "group")
            confirmation = confirm_duplicate_identifiers(self.conn, incoming, "", details["confirmationToken"])
            self.assertEqual(confirmation["matchCount"], 1)
            with self.conn:
                upsert_intake_batch(self.conn, incoming)
            with self.conn:
                delete_intake_batch(self.conn, incoming["id"])
        self.assertEqual(self.item()["quantity"], 60)

    def test_member_filter_and_options_return_one_record_and_use_lookup_index(self):
        with self.conn:
            upsert_intake_batch(self.conn, self.grouped())
        for field, values in (("purchaseOrderNo", PURCHASES), ("orderNo", ORDERS), ("batchNo", BATCHES)):
            for value in values:
                page = list_intake_batches_page(
                    self.conn,
                    {"columnFilters": {field: [value]}, "limit": 10, "offset": 0},
                    filtered_where,
                    ENTITY_ORDER_BY,
                )
                self.assertEqual(page["page"]["total"], 1)
            options = list_intake_batch_filter_options(self.conn, {}, filtered_where, field)["items"]
            self.assertEqual(len(options), 2)
            self.assertTrue(all(item["count"] == 1 for item in options))
        plan = " ".join(
            str(tuple(row))
            for row in self.conn.execute(
                "EXPLAIN QUERY PLAN SELECT batch_id FROM intake_identifier_members WHERE kind=? AND value_key=?",
                ("orderNo", ORDERS[1]),
            )
        )
        self.assertIn("idx_intake_identifier_member_key", plan)

    def test_edit_and_delete_remove_old_members_without_erasing_other_records(self):
        with self.conn:
            upsert_intake_batch(self.conn, self.grouped())
            upsert_intake_batch(
                self.conn, {**self.item(), "purchaseOrderNo": PURCHASES[0], "orderNo": ORDERS[0], "batchNo": BATCHES[0]}
            )
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM intake_identifier_members").fetchone()[0], 3)
        self.assertEqual(self.item()["identifiers"]["orderNos"], [ORDERS[0]])
        with self.conn:
            delete_intake_batch(self.conn, "group")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM intake_identifier_members").fetchone()[0], 0)

    def legacy(self):
        item = self.grouped()
        with self.conn:
            upsert_intake_batch(self.conn, item)
            self.conn.execute(
                "UPDATE intake_batches SET payload=?,purchase_order_no=?,order_no=?,updated_at=? WHERE id=?",
                (json.dumps(item, ensure_ascii=False), item["purchaseOrderNo"], "", "old-version", item["id"]),
            )
            self.conn.execute("DELETE FROM intake_identifier_members")
        return item

    def test_migration_groups_existing_record_once_with_audit_and_version(self):
        original = self.legacy()
        with self.conn:
            ensure_intake_identifier_groups(self.conn)
        updated = self.item()
        self.assertEqual(updated["quantity"], 60)
        self.assertNotEqual(updated["updatedAt"], "old-version")
        for field in ("cards", "receipts", "rawMessage", "recognition", "iacuc"):
            self.assertEqual(updated[field], original[field])
        self.assertEqual(
            self.conn.execute(
                "SELECT COUNT(*) FROM audit_events WHERE action='intake_batch.identifiers_grouped'"
            ).fetchone()[0],
            1,
        )
        changes = self.conn.total_changes
        with self.conn:
            ensure_intake_identifier_groups(self.conn)
        self.assertEqual(self.conn.total_changes, changes)

    def test_migration_audit_failure_rolls_back_payload_version_and_members(self):
        self.legacy()
        with self.conn:
            self.conn.execute(
                "CREATE TRIGGER reject_group_audit BEFORE INSERT ON audit_events WHEN NEW.action='intake_batch.identifiers_grouped' BEGIN SELECT RAISE(ABORT,'blocked audit'); END"
            )
        snapshot = list(self.conn.iterdump())
        with self.assertRaises(sqlite3.IntegrityError), self.conn:
            ensure_intake_identifier_groups(self.conn)
        self.assertEqual(list(self.conn.iterdump()), snapshot)

    def test_saved_source_evidence_is_not_reclassified_or_rewritten(self):
        source = {
            "imageIndex": 1,
            "kind": "purchase",
            "purchaseOrderNo": "、".join(ORDERS),
            "batchNo": "(Z2025034)2025090302",
        }
        saved = sanitize_evidence({"sources": [source]})
        for key, value in source.items():
            self.assertEqual(saved["sources"][0][key], value)

    @patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_text_ai_keeps_complete_real_group_and_total_without_pairing(self, chat):
        chat.return_value = ({"orderNo": ORDERS[0], "batchNo": BATCHES[0], "quantity": 60}, {})
        text = "锐竞订单号：" + "、".join(ORDERS) + "\n饲养需求批次号：" + "、".join(BATCHES) + "\n数量：60只"
        item, _ = ai_parse_intake_message(text)
        self.assertEqual(item["identifiers"], {"purchaseOrderNos": PURCHASES, "orderNos": ORDERS, "batchNos": BATCHES})
        self.assertEqual(item["quantity"], 60)
        self.assertEqual(item["iacuc"], "Z2025034")
        self.assertNotIn("pairings", item)

    def test_different_iacuc_demands_cannot_silently_use_first_project(self):
        item = normalize_intake_order_identifiers(self.grouped())
        item["batchNo"] += "、（Z2025035）2025090302"
        with self.assertRaisesRegex(ValueError, "不同IACUC"):
            validate_entity_payload("intakeBatches", item)

    def test_different_orders_misplaced_in_two_fields_are_kept_in_one_group(self):
        item = normalize_intake_order_identifiers({"purchaseOrderNo": ORDERS[0], "orderNo": ORDERS[1]})
        self.assertEqual(item["identifiers"]["orderNos"], ORDERS)
        self.assertEqual(item["identifiers"]["purchaseOrderNos"], PURCHASES)

    def test_case_duplicate_array_members_do_not_fail_the_database_projection(self):
        incoming = batch("case-group", purchaseOrderNo="", orderNo="")
        incoming.pop("purchaseOrderNo")
        incoming["identifiers"] = {"purchaseOrderNos": ["External-1", "external-1"], "orderNos": [], "batchNos": []}
        with self.conn:
            upsert_intake_batch(self.conn, incoming)
        item = self.item("case-group")
        self.assertEqual(item["identifiers"]["purchaseOrderNos"], ["External-1"])
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM intake_identifier_members WHERE kind='purchaseOrderNo'").fetchone()[
                0
            ],
            1,
        )

    def test_matching_number_sets_do_not_allow_auto_merge_of_different_business_iacuc(self):
        existing = normalize_intake_order_identifiers(self.grouped())
        incoming = {**existing, "iacuc": "Z2025035"}
        preview = _candidate(existing, incoming, [{"id": existing["id"]}])
        self.assertFalse(preview["canMerge"])
        self.assertIn("IACUC不一致", preview["reason"])
        self.assertIsNone(preview["mergedItem"])
