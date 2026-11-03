"""Purchase requests and full platform orders stay separate across storage and matching."""

import json
import sqlite3
import unittest
from io import BytesIO
from unittest.mock import patch

from openpyxl import load_workbook

from server_app.domains.intake.ai_parse import _normalize_payload
from server_app.domains.intake.duplicates import IntakeDuplicateConfirmationRequired
from server_app.domains.intake.recognition_evidence import structure_image_sources
from server_app.domains.state.entity_mutations import normalize_intake_batches_for_state_write
from server_app.persistence.billing_schema import initialize_billing_schema
from server_app.persistence.intake_identifiers import ensure_intake_identifier_schema
from server_app.persistence.system_schema import initialize_system_schema
from server_app.repositories.audit_storage import read_payload
from server_app.repositories.entities import list_intake_batch_filter_options, list_intake_batches_page
from server_app.repositories.filter_options import filtered_where
from server_app.shared.intake_identifiers import normalize_intake_order_identifiers
from server_app.web.entity_contracts import ENTITY_ORDER_BY
from tests import test_intake_duplicates as duplicate_tests
from tests import test_intake_recognition_merge as merge_tests
from tests import test_reception as reception_tests
from tests.test_intake_duplicates import batch

PURCHASE = "C2026080333568"
ORDER = "DC202608033356801"


class OrderNormalizationTests(unittest.TestCase):
    def test_split_legacy_or_explicit_order_and_preserve_complete_suffix(self):
        for suffix in ("01", "07"):
            order = ORDER[:-2] + suffix
            for item in (
                {"purchaseOrderNo": order},
                {"orderNo": order.lower()},
                {"purchaseOrderNo": PURCHASE, "orderNo": order},
            ):
                with self.subTest(item=item):
                    actual = normalize_intake_order_identifiers({**item, "rawMessage": "原文DC不截断"})
                    self.assertEqual((actual["purchaseOrderNo"], actual["orderNo"]), (PURCHASE, order))
                    self.assertEqual(actual["rawMessage"], "原文DC不截断")
                    self.assertEqual(actual, normalize_intake_order_identifiers(actual))

    def test_storage_preserves_missing_keys_without_changing_api_projection(self):
        for fields in (
            {},
            {"purchaseOrderNo": "PO-legacy"},
            {"orderNo": "EXTERNAL-7"},
            {"purchaseOrderNo": ""},
            {"orderNo": ""},
        ):
            before = {"id": "legacy", "rawMessage": "original", **fields}
            actual = normalize_intake_order_identifiers(before, preserve_missing=True)
            self.assertEqual(actual, before)
            self.assertIsNot(actual, before)
            self.assertEqual(normalize_intake_order_identifiers(actual, preserve_missing=True), before)
            projected = normalize_intake_order_identifiers(before)
            self.assertIn("purchaseOrderNo", projected)
            self.assertIn("orderNo", projected)

    def test_storage_still_derives_real_identifiers_and_keeps_explicit_clear(self):
        for fields in ({"purchaseOrderNo": ORDER}, {"orderNo": ORDER}):
            self.assertEqual(
                normalize_intake_order_identifiers(fields, preserve_missing=True),
                {"purchaseOrderNo": PURCHASE, "orderNo": ORDER},
            )
        old = {"intakeBatches": [batch("old", purchaseOrderNo=PURCHASE, orderNo=ORDER)]}
        incoming = batch("old", purchaseOrderNo=PURCHASE, orderNo="")
        result = normalize_intake_batches_for_state_write(old, {"intakeBatches": [incoming]})
        self.assertEqual(result["intakeBatches"][0]["orderNo"], "")
        self.assertEqual(old["intakeBatches"][0]["orderNo"], ORDER)

    def test_unknown_and_description_values_are_not_guessed(self):
        for value in ("不走锐竞", "PO202610005", "DC123", "DC2026080333568", "DC2026080333568019"):
            actual = normalize_intake_order_identifiers({"purchaseOrderNo": value})
            self.assertEqual((actual["purchaseOrderNo"], actual["orderNo"]), (value, ""))
        self.assertEqual(normalize_intake_order_identifiers({"orderNo": "XYZ-07"})["purchaseOrderNo"], "")
        for unknown_order in ("DC２０２６１１０２２９４８６０７", "DC٢٠٢٦١١٠٢٢٩٤٨٦٠٧"):
            actual = normalize_intake_order_identifiers({"orderNo": unknown_order})
            self.assertEqual((actual["purchaseOrderNo"], actual["orderNo"]), ("", unknown_order))

    def test_explicit_mismatch_is_rejected(self):
        for item in (
            {"purchaseOrderNo": "C2026080333569", "orderNo": ORDER},
            {"purchaseOrderNo": "不走锐竞", "orderNo": ORDER},
            {"purchaseOrderNo": ORDER, "orderNo": ORDER[:-2] + "07"},
        ):
            with self.subTest(item=item), self.assertRaisesRegex(ValueError, "核对"):
                normalize_intake_order_identifiers(item)

    def test_ai_and_per_image_sources_link_c_and_dc_but_reject_different_full_orders(self):
        self.assertEqual(_normalize_payload({"purchaseOrderNo": ORDER})["orderNo"], ORDER)
        result = structure_image_sources(
            {
                "imageSources": [
                    {"kind": "purchase", "imageIndex": 1, "purchaseOrderNo": PURCHASE},
                    {"kind": "purchase", "imageIndex": 2, "orderNo": ORDER},
                ]
            }
        )
        self.assertEqual((result["purchaseOrderNo"], result["orderNo"]), (PURCHASE, ORDER))
        with self.assertRaisesRegex(ValueError, "不一致"):
            structure_image_sources(
                {
                    "imageSources": [
                        {"kind": "purchase", "imageIndex": 1, "orderNo": ORDER},
                        {"kind": "purchase", "imageIndex": 2, "orderNo": ORDER[:-2] + "07"},
                    ]
                }
            )

    def test_legacy_full_state_omission_retains_order_and_conflicts_reject_before_write(self):
        old = {"intakeBatches": [batch("old", purchaseOrderNo=PURCHASE, orderNo=ORDER)]}
        item = batch("old", purchaseOrderNo=PURCHASE)
        result = normalize_intake_batches_for_state_write(old, {"intakeBatches": [item]})
        self.assertEqual(result["intakeBatches"][0]["orderNo"], ORDER)
        with self.assertRaisesRegex(ValueError, "不一致"):
            normalize_intake_batches_for_state_write(
                old, {"intakeBatches": [{**item, "purchaseOrderNo": "C2026080333569"}]}
            )


class OrderMigrationTests(unittest.TestCase):
    def database(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        initialize_billing_schema(conn)
        initialize_system_schema(conn)
        self.addCleanup(conn.close)
        return conn

    def insert_legacy(self, conn):
        item = batch(
            "legacy",
            purchaseOrderNo=ORDER,
            updatedAt="saved-version",
            rawMessage="原文" + ORDER,
            recognition={
                "images": [{"id": "image-original", "sha256": "x"}],
                "fieldSources": {"purchaseOrderNo": "原图" + ORDER},
            },
            receipts=[{"id": "receipt", "actualReceiptDate": "2026-10-21"}],
            cards=[{"qrId": "unchanged"}],
        )
        conn.execute(
            "INSERT INTO intake_batches(id,batch_no,status,updated_at,payload) VALUES(?,?,?,?,?)",
            (item["id"], item["batchNo"], item["status"], item["updatedAt"], json.dumps(item, ensure_ascii=False)),
        )
        conn.commit()
        return item

    def test_migration_splits_payload_and_scalar_fields_preserves_evidence_and_version_and_audits_once(self):
        conn = self.database()
        before = self.insert_legacy(conn)
        with conn:
            ensure_intake_identifier_schema(conn)
        row = conn.execute("SELECT * FROM intake_batches").fetchone()
        actual = json.loads(row["payload"])
        self.assertEqual(actual, {**before, "purchaseOrderNo": PURCHASE, "orderNo": ORDER})
        self.assertEqual(
            (row["purchase_order_no"], row["order_no"], row["order_key"], row["updated_at"]),
            (PURCHASE, ORDER, ORDER, "saved-version"),
        )
        event = conn.execute("SELECT * FROM audit_events WHERE action='intake_batch.identifiers_migrated'").fetchone()
        payload = json.loads(read_payload(conn, event["id"]))
        self.assertEqual(
            payload["before"], {key: before[key] for key in ("purchaseOrderNo", "orderNo") if key in before}
        )
        self.assertEqual(payload["after"], {"purchaseOrderNo": PURCHASE, "orderNo": ORDER})
        changes = conn.total_changes
        with conn:
            ensure_intake_identifier_schema(conn)
        self.assertEqual(changes, conn.total_changes)
        self.assertEqual(conn.execute("SELECT count(*) FROM audit_events").fetchone()[0], 1)

    def test_missing_identifier_payload_bytes_and_audits_survive_schema_upgrade(self):
        conn = self.database()
        originals = {}
        for index, fields in enumerate(({}, {"purchaseOrderNo": ""}, {"orderNo": ""}, {"purchaseOrderNo": "PO-old"})):
            item = {"id": f"legacy-{index}", "batchNo": f"B-{index}", "updatedAt": "saved", **fields}
            raw = json.dumps(item, ensure_ascii=False, indent=2)
            originals[item["id"]] = raw
            conn.execute(
                "INSERT INTO intake_batches(id,batch_no,status,updated_at,payload) VALUES(?,?,?,?,?)",
                (item["id"], item["batchNo"], "pending_receipt", "saved", raw),
            )
        conn.commit()
        with conn:
            ensure_intake_identifier_schema(conn)
        for row in conn.execute("SELECT id,payload,order_no FROM intake_batches"):
            self.assertEqual(row["payload"], originals[row["id"]])
            self.assertEqual(row["order_no"], "")
        self.assertEqual(conn.execute("SELECT count(*) FROM audit_events").fetchone()[0], 0)
        changes = conn.total_changes
        with conn:
            ensure_intake_identifier_schema(conn)
        self.assertEqual(changes, conn.total_changes)

    def test_upsert_preserves_absent_payload_fields_but_populates_lookup_columns(self):
        from server_app.repositories.entities import upsert_intake_batch

        conn = self.database()
        with conn:
            ensure_intake_identifier_schema(conn)
            item = {"id": "legacy", "batchNo": "B-old", "updatedAt": "saved"}
            upsert_intake_batch(conn, item)
        row = conn.execute("SELECT payload,purchase_order_no,order_no FROM intake_batches").fetchone()
        self.assertEqual(json.loads(row["payload"]), item)
        self.assertEqual((row["purchase_order_no"], row["order_no"]), ("", ""))

    def test_audit_failure_rolls_back_columns_payload_and_lookup_values(self):
        conn = self.database()
        self.insert_legacy(conn)
        before = conn.execute("SELECT payload FROM intake_batches").fetchone()[0]
        columns = [row[1] for row in conn.execute("PRAGMA table_info(intake_batches)")]
        with patch(
            "server_app.persistence.intake_identifiers.insert_audit_events",
            side_effect=sqlite3.IntegrityError("audit failure"),
        ):
            with self.assertRaises(sqlite3.IntegrityError), conn:
                ensure_intake_identifier_schema(conn)
        self.assertEqual([row[1] for row in conn.execute("PRAGMA table_info(intake_batches)")], columns)
        self.assertEqual(conn.execute("SELECT payload FROM intake_batches").fetchone()[0], before)
        self.assertEqual(conn.execute("SELECT count(*) FROM audit_events").fetchone()[0], 0)
        with conn:
            ensure_intake_identifier_schema(conn)
        self.assertEqual(conn.execute("SELECT order_no FROM intake_batches").fetchone()[0], ORDER)


class OrderWriteTests(unittest.TestCase):
    setUp = duplicate_tests.IntakeDuplicateTests.setUp
    connect = duplicate_tests.IntakeDuplicateTests.connect
    save = duplicate_tests.IntakeDuplicateTests.save
    counts = duplicate_tests.IntakeDuplicateTests.counts

    def test_list_projection_filters_and_sort_distinguish_order_suffixes(self):
        self.save(batch("order01", purchaseOrderNo=ORDER))
        self.save(batch("order07", purchaseOrderNo=ORDER[:-2] + "07"))
        with self.connect() as conn:
            params = {"limit": 10, "offset": 0, "view": "summary", "sortKey": "orderNo", "sortDir": "asc"}
            result = list_intake_batches_page(conn, params, filtered_where, ENTITY_ORDER_BY)
            self.assertEqual([item["orderNo"] for item in result["items"]], [ORDER, ORDER[:-2] + "07"])
            for column, value, expected in (("purchaseOrderNo", PURCHASE, 2), ("orderNo", ORDER, 1)):
                result = list_intake_batches_page(
                    conn, {**params, "columnFilters": {column: [value]}}, filtered_where, ENTITY_ORDER_BY
                )
                self.assertEqual(result["page"]["total"], expected)
            options = list_intake_batch_filter_options(conn, params, filtered_where, "orderNo")
            self.assertEqual([item["value"] for item in options["items"]], [ORDER, ORDER[:-2] + "07"])

    def test_explanations_in_either_identifier_field_do_not_create_duplicate_orders(self):
        self.save(batch("description", purchaseOrderNo="不走锐竞", orderNo="不走锐竞", batchNo="old"))
        saved = self.save(
            batch("new-description", purchaseOrderNo="不走锐竞", orderNo="不走锐竞", batchNo="new"),
            checkDuplicates=True,
        )
        self.assertEqual(saved["orderNo"], "不走锐竞")

    def test_save_split_duplicate_lookup_and_legacy_edit_keep_order(self):
        saved = self.save(batch("original", purchaseOrderNo=ORDER))
        self.assertEqual((saved["purchaseOrderNo"], saved["orderNo"]), (PURCHASE, ORDER))
        with self.assertRaises(IntakeDuplicateConfirmationRequired) as caught:
            self.save(batch("other", purchaseOrderNo=PURCHASE, batchNo="another"), checkDuplicates=True)
        self.assertEqual(caught.exception.details["items"][0]["orderNo"], ORDER)
        edited = {**saved, "notes": "只改备注"}
        del edited["orderNo"]
        saved = self.save(edited, exists=True)
        self.assertEqual(saved["orderNo"], ORDER)
        with self.connect() as conn:
            row = conn.execute("SELECT purchase_order_no,order_no,payload FROM intake_batches").fetchone()
            self.assertEqual((row[0], row[1]), (PURCHASE, ORDER))
            self.assertEqual(json.loads(row[2])["orderNo"], ORDER)
        before = self.counts()
        with self.assertRaisesRegex(ValueError, "不一致"):
            self.save({**saved, "purchaseOrderNo": "C2026080333569"}, exists=True)
        self.assertEqual(self.counts(), before)


class OrderMergeTests(unittest.TestCase):
    setUp = merge_tests.RecognitionMergeTests.setUp
    connect = merge_tests.RecognitionMergeTests.connect
    save = merge_tests.RecognitionMergeTests.save
    original = merge_tests.RecognitionMergeTests.original
    preview = merge_tests.RecognitionMergeTests.preview
    merge = merge_tests.RecognitionMergeTests.merge

    def test_c_message_merges_into_dc_image_record_but_suffix_change_does_not(self):
        original = self.original(purchaseOrderNo=ORDER)
        incoming = {**self.incoming, "purchaseOrderNo": PURCHASE}
        candidate = self.preview(incoming)["items"][0]
        self.assertTrue(candidate["canMerge"])
        merged = self.merge(candidate, incoming)
        self.assertEqual((merged["purchaseOrderNo"], merged["orderNo"]), (PURCHASE, ORDER))
        self.assertEqual(merged["recognition"]["images"], original["recognition"]["images"])
        conflict = self.preview({**incoming, "orderNo": ORDER[:-2] + "07"})["items"][0]
        self.assertFalse(conflict["canMerge"])
        self.assertEqual(conflict["classification"], "association_conflict")


class OrderReceptionTests(unittest.TestCase):
    setUp = reception_tests.ReceptionTests.setUp
    put = reception_tests.ReceptionTests.put
    listed = reception_tests.ReceptionTests.listed
    body = reception_tests.ReceptionTests.body

    def test_reception_list_filter_and_workbook_keep_full_order(self):
        self.batch["purchaseOrderNo"] = ORDER
        self.put(self.batch)
        item = self.listed()["items"][0]
        self.assertEqual((item["purchaseOrderNo"], item["orderNo"]), (PURCHASE, ORDER))
        for column, value in (("purchaseOrderNo", PURCHASE), ("orderNo", ORDER)):
            self.assertEqual(self.listed(columnFilters=json.dumps({column: [value]}))["page"]["total"], 1)
            self.assertEqual(self.listed(columnFilters=json.dumps({column: [value + "missing"]}))["page"]["total"], 0)
        from server_app.domains.reception import service, workbook

        document = service.preview(self.conn, {"id": "admin", "role": "admin"}, self.body())
        book = load_workbook(BytesIO(workbook.generate(document)))
        self.addCleanup(book.close)
        sheet = book["接收登记"]
        self.assertEqual(sheet["B4"].value, ORDER)
