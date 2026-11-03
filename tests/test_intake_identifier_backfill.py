import json
import sqlite3
import unittest

from server_app.persistence.billing_schema import initialize_billing_schema
from server_app.persistence.infrastructure_schema import initialize_infrastructure_schema
from server_app.persistence.intake_identifier_backfill import backfill_intake_identifiers
from server_app.persistence.intake_identifiers import ensure_intake_identifier_schema
from server_app.persistence.system_schema import initialize_system_schema
from server_app.repositories.audit import insert_audit_events
from server_app.repositories.audit_storage import read_payload
from server_app.shared.concurrency import StaleWriteError, require_current_version

MARKER = "intakeIdentifierBackfillV1"
PURCHASE = "C2026110229486"
ORDER = "DC202611022948607"
VERSION = "2026-10-01T00:00:00+00:00"


class IntakeIdentifierBackfillTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        with self.conn:
            initialize_infrastructure_schema(self.conn)
            initialize_billing_schema(self.conn)
            initialize_system_schema(self.conn)
            ensure_intake_identifier_schema(self.conn)

    def seed(self, identity, raw, **fields):
        item = {
            "id": identity,
            "batchNo": "（Z2024020）2026100812",
            "rawMessage": raw,
            "iacuc": "Z2024020",
            "supplier": "人工确认供应商",
            "pi": "人工负责人",
            "owner": "人工预约人",
            "roomName": "8014",
            "intakeDate": "2026-11-03",
            "status": "pending_print",
            "updatedAt": VERSION,
            "quantity": 6,
            "finalCardCount": 1,
            "cards": [],
            "receipts": [],
            "customLegacyField": {"nested": [1, "原值"]},
            **fields,
        }
        purchase = item.get("purchaseOrderNo") or ""
        order = item.get("orderNo") or ""
        self.conn.execute(
            """INSERT INTO intake_batches (
                id,batch_no,iacuc,supplier,pi,owner,quantity,card_count,room_name,
                intake_date,status,updated_at,payload,purchase_order_no,purchase_order_key,
                batch_no_key,order_no,order_key
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                identity,
                item["batchNo"],
                item["iacuc"],
                item["supplier"],
                item["pi"],
                item["owner"],
                item["quantity"],
                item["finalCardCount"],
                item["roomName"],
                item["intakeDate"],
                item["status"],
                item["updatedAt"],
                json.dumps(item, ensure_ascii=False),
                purchase,
                purchase.strip().upper(),
                "(Z2024020)2026100812",
                order,
                order.strip().upper(),
            ),
        )
        self.conn.commit()
        return item

    def row(self, identity):
        return self.conn.execute("SELECT * FROM intake_batches WHERE id=?", (identity,)).fetchone()

    def item(self, identity):
        return json.loads(self.row(identity)["payload"])

    def run_backfill(self):
        with self.conn:
            return backfill_intake_identifiers(self.conn)

    def events(self, action, identity=None):
        sql = "SELECT id FROM audit_events WHERE action=?"
        params = [action]
        if identity is not None:
            sql += " AND entity_id=?"
            params.append(identity)
        return [json.loads(read_payload(self.conn, row["id"])) for row in self.conn.execute(sql, params)]

    def record_manual_clear(self, identity, field, previous, *, explicit=True):
        insert_audit_events(
            self.conn,
            [
                {
                    "id": f"manual-clear-{identity}",
                    "actorUserId": "admin",
                    "actorUsername": "admin",
                    "actorDisplayName": "人工管理员",
                    "action": "intake_batch.updated",
                    "entityType": "intake_batch",
                    "entityId": identity,
                    "message": "人工清空编号",
                    "slotIds": [],
                    "at": "2026-11-03T00:00:00+00:00",
                    "before": {field: previous},
                    "after": {field: ""} if explicit else {},
                }
            ],
        )
        self.conn.commit()

    def assert_only_identifiers_changed(self, before, after):
        allowed = {"purchaseOrderNo", "orderNo", "updatedAt"}
        self.assertEqual(
            {key: value for key, value in before.items() if key not in allowed},
            {key: value for key, value in after.items() if key not in allowed},
        )

    def test_unique_empty_and_missing_fields_are_backfilled_with_indexes_and_versions(self):
        originals = {
            "empty": self.seed("empty", f"锐竞订单号：{PURCHASE}，", purchaseOrderNo="", orderNo=""),
            "missing": self.seed("missing", f"申请单号为{PURCHASE}，"),
            "order": self.seed("order", f"采购申请号：{ORDER}", purchaseOrderNo="", orderNo=""),
        }
        tables_before = list(self.conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"))
        summary = self.run_backfill()
        self.assertEqual(summary, {"scanned": 3, "changed": 3, "skipped": 0, "withoutEvidence": 0})
        self.assertIsNotNone(self.conn.execute("SELECT value FROM app_settings WHERE key=?", (MARKER,)).fetchone())
        self.assertEqual(
            tables_before, list(self.conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"))
        )
        for identity, before in originals.items():
            with self.subTest(identity=identity):
                after, row = self.item(identity), self.row(identity)
                self.assert_only_identifiers_changed(before, after)
                self.assertEqual(after["purchaseOrderNo"], PURCHASE)
                self.assertEqual(row["purchase_order_no"], PURCHASE)
                self.assertEqual(row["purchase_order_key"], PURCHASE)
                self.assertEqual(row["batch_no_key"], "(Z2024020)2026100812")
                self.assertNotEqual(after["updatedAt"], VERSION)
                self.assertEqual(row["updated_at"], after["updatedAt"])
                with self.assertRaises(StaleWriteError):
                    require_current_version(after, VERSION, "待接收批次")
                with self.assertRaises(StaleWriteError):
                    require_current_version(row, VERSION, "待接收批次")
                events = self.events("intake_batch.identifiers_backfilled", identity)
                self.assertEqual(len(events), 1)
                self.assertEqual(events[0]["entityType"], "intake_batch")
                if identity == "order":
                    self.assertEqual(after["orderNo"], ORDER)
                    self.assertEqual(row["order_no"], ORDER)
                    self.assertEqual(row["order_key"], ORDER)

    def test_nonempty_matching_values_are_preserved_while_only_missing_partner_is_filled(self):
        unchanged = self.seed("complete", f"{PURCHASE}，{ORDER}", purchaseOrderNo=PURCHASE, orderNo=ORDER)
        before_row = tuple(self.row("complete"))
        before_partial = self.seed("partial", f"{PURCHASE}，{ORDER}", purchaseOrderNo=PURCHASE, orderNo="")
        summary = self.run_backfill()
        self.assertEqual(summary["changed"], 1)
        self.assertEqual(summary["skipped"], 0)
        self.assertEqual(self.item("complete"), unchanged)
        self.assertEqual(tuple(self.row("complete")), before_row)
        self.assertEqual(self.events("intake_batch.identifiers_backfilled", "complete"), [])
        partial = self.item("partial")
        self.assertEqual(partial["purchaseOrderNo"], PURCHASE)
        self.assertEqual(partial["orderNo"], ORDER)
        self.assert_only_identifiers_changed(before_partial, partial)

    def test_null_empty_and_whitespace_fields_follow_existing_blank_form_compatibility(self):
        originals = {
            str(index): self.seed(str(index), ORDER, purchaseOrderNo=blank, orderNo=blank)
            for index, blank in enumerate((None, "", " \t"))
        }
        self.assertEqual(self.run_backfill()["changed"], len(originals))
        for identity, before in originals.items():
            with self.subTest(identity=identity):
                after = self.item(identity)
                self.assertEqual((after["purchaseOrderNo"], after["orderNo"]), (PURCHASE, ORDER))
                self.assert_only_identifiers_changed(before, after)

    def test_multiple_candidates_prefix_conflicts_and_manual_conflicts_skip_entire_record(self):
        cases = {
            "multiple-c": (f"{PURCHASE}，C2026100925690", {}),
            "multiple-dc": (f"{ORDER}，DC202611022948601", {}),
            "source-conflict": (f"C2026100925690，{ORDER}", {}),
            "manual-c": (f"{PURCHASE}，{ORDER}", {"purchaseOrderNo": "人工保留编号", "orderNo": ""}),
            "manual-dc": (f"{PURCHASE}，{ORDER}", {"purchaseOrderNo": "", "orderNo": "人工订单"}),
        }
        for identity, (raw, fields) in cases.items():
            self.seed(identity, raw, **fields)
        before = {identity: tuple(self.row(identity)) for identity in cases}
        summary = self.run_backfill()
        self.assertEqual(summary["changed"], 0)
        self.assertEqual(summary["skipped"], len(cases))
        for identity in cases:
            with self.subTest(identity=identity):
                self.assertEqual(tuple(self.row(identity)), before[identity])
                self.assertEqual(len(self.events("intake_batch.identifier_backfill_skipped", identity)), 1)
                self.assertEqual(self.events("intake_batch.identifiers_backfilled", identity), [])

    def test_fullwidth_and_repeated_equivalent_tokens_are_normalized_without_rewriting_evidence(self):
        raw = f"锐竞采购申请号：ｃ２０２６１１０２２９４８６\n{PURCHASE}\nｄｃ２０２６１１０２２９４８６０７，{ORDER}"
        before = self.seed("wide", raw, purchaseOrderNo="", orderNo="")
        self.assertEqual(self.run_backfill()["changed"], 1)
        after = self.item("wide")
        self.assertEqual((after["purchaseOrderNo"], after["orderNo"]), (PURCHASE, ORDER))
        self.assertEqual(after["rawMessage"], raw)
        self.assert_only_identifiers_changed(before, after)

    def test_inconsistent_payload_identity_is_archived_without_updating_the_record(self):
        self.seed("stored-row", PURCHASE, purchaseOrderNo="")
        payload = self.item("stored-row")
        payload.pop("id")
        self.conn.execute("UPDATE intake_batches SET payload=? WHERE id='stored-row'", (json.dumps(payload),))
        self.conn.commit()
        before = self.row("stored-row")
        self.assertEqual(self.run_backfill()["skipped"], 1)
        self.assertEqual(self.row("stored-row"), before)
        events = self.events("intake_batch.identifier_backfill_skipped", "stored-row")
        self.assertEqual(events[0]["source"]["reason"], "source_identity_mismatch")

    def test_conflicting_preserved_image_evidence_is_not_overridden_by_source_text(self):
        for identity, recognition in (
            ("source", {"sources": [{"kind": "purchase", "purchaseOrderNo": "C2026100925690"}]}),
            ("field", {"fieldSources": {"orderNo": "图1 订单号 DC202610092569001"}}),
        ):
            self.seed(identity, PURCHASE, purchaseOrderNo="", recognition=recognition)
        before = list(self.conn.execute("SELECT * FROM intake_batches ORDER BY id"))
        self.assertEqual(self.run_backfill()["skipped"], 2)
        self.assertEqual(list(self.conn.execute("SELECT * FROM intake_batches ORDER BY id")), before)
        for event in self.events("intake_batch.identifier_backfill_skipped"):
            self.assertEqual(event["source"]["reason"], "recognition_evidence_mismatch")

    def test_short_spaced_and_embedded_tokens_are_not_truncated_into_identifiers(self):
        cases = [
            "采购单号：C20261009 25690",
            "采购单号：Ｃ２０２６１００９　２５６９０",
            "订单编号：DC2026110229486072",
            "采购单号：C20261102294860",
            "采购单号：AC2026110229486",
            "订单编号：DC202611022948607A",
            "采购单号：2026110229486",
            "采购单号：不走锐竞",
        ]
        for index, raw in enumerate(cases):
            self.seed(str(index), raw, purchaseOrderNo="", orderNo="")
        before = list(self.conn.execute("SELECT * FROM intake_batches ORDER BY id"))
        summary = self.run_backfill()
        self.assertEqual(summary, {"scanned": len(cases), "changed": 0, "skipped": 0, "withoutEvidence": len(cases)})
        self.assertEqual(before, list(self.conn.execute("SELECT * FROM intake_batches ORDER BY id")))

    def test_received_cards_receipts_and_original_recognition_evidence_are_unchanged(self):
        before = self.seed(
            "received",
            f"锐竞采购申请号：{PURCHASE}",
            status="received",
            cards=[{"id": "animal-record", "iacuc": "Z2024020", "status": "received", "custom": ["保留"]}],
            receipts=[{"id": "receipt-1", "receivedAt": "2026-11-03", "quantity": 6}],
            recognition={
                "extractedText": "原图编号写法不可改写",
                "warnings": ["人工已核对"],
                "fieldSources": {"purchaseOrderNo": "历史图片"},
                "images": [{"id": "image-1", "sha256": "original-hash", "url": "/original/image-1"}],
            },
        )
        self.assertEqual(self.run_backfill()["changed"], 1)
        self.assert_only_identifiers_changed(before, self.item("received"))
        self.assertEqual(self.row("received")["status"], "received")

    def test_marker_makes_repeated_startup_read_only_and_still_locks_before_checking_it(self):
        self.seed("once", PURCHASE, purchaseOrderNo="")
        summary = self.run_backfill()
        before = list(self.conn.iterdump())
        changes = self.conn.total_changes
        traced = []
        self.conn.set_trace_callback(traced.append)
        try:
            self.assertEqual(self.run_backfill(), summary)
        finally:
            self.conn.set_trace_callback(None)
        self.assertEqual(self.conn.total_changes, changes)
        self.assertEqual(list(self.conn.iterdump()), before)
        marker_read = next(index for index, sql in enumerate(traced) if "app_settings" in sql.lower())
        lock = next(index for index, sql in enumerate(traced) if sql.strip().upper() == "BEGIN IMMEDIATE")
        self.assertLess(lock, marker_read)

    def test_explicit_historical_manual_clears_are_preserved_but_missing_audit_fields_are_not_clears(self):
        for identity, field, previous in (("clear-c", "purchaseOrderNo", PURCHASE), ("clear-dc", "orderNo", ORDER)):
            self.seed(identity, ORDER, purchaseOrderNo="", orderNo="")
            self.record_manual_clear(identity, field, previous)
        self.seed("omitted", PURCHASE, purchaseOrderNo="")
        self.record_manual_clear("omitted", "purchaseOrderNo", PURCHASE, explicit=False)
        before = {identity: tuple(self.row(identity)) for identity in ("clear-c", "clear-dc")}
        summary = self.run_backfill()
        self.assertEqual((summary["changed"], summary["skipped"]), (1, 2))
        for identity in before:
            self.assertEqual(tuple(self.row(identity)), before[identity])
            self.assertEqual(len(self.events("intake_batch.identifier_backfill_skipped", identity)), 1)
        self.assertEqual(self.item("omitted")["purchaseOrderNo"], PURCHASE)

    def test_manual_clear_after_completion_is_not_filled_again(self):
        self.seed("cleared-later", PURCHASE, purchaseOrderNo="")
        summary = self.run_backfill()
        cleared = {**self.item("cleared-later"), "purchaseOrderNo": "", "updatedAt": "manual-version"}
        self.conn.execute(
            "UPDATE intake_batches SET payload=?,purchase_order_no='',purchase_order_key='',updated_at=? WHERE id=?",
            (json.dumps(cleared), "manual-version", "cleared-later"),
        )
        self.record_manual_clear("cleared-later", "purchaseOrderNo", PURCHASE)
        before = list(self.conn.iterdump())
        changes = self.conn.total_changes
        self.assertEqual(self.run_backfill(), summary)
        self.assertEqual(list(self.conn.iterdump()), before)
        self.assertEqual(self.conn.total_changes, changes)
        self.assertEqual(self.item("cleared-later")["purchaseOrderNo"], "")

    def test_audit_failure_rolls_back_data_lookup_keys_versions_marker_and_prior_events(self):
        for identity in ("a", "b"):
            self.seed(identity, ORDER, purchaseOrderNo="", orderNo="")
        self.conn.execute(
            """CREATE TRIGGER fail_second_backfill_audit BEFORE INSERT ON audit_events
                WHEN NEW.action='intake_batch.identifiers_backfilled' AND NEW.entity_id='b'
                BEGIN SELECT RAISE(ABORT,'backfill audit failed'); END"""
        )
        self.conn.commit()
        before = list(self.conn.iterdump())
        with self.assertRaisesRegex(sqlite3.IntegrityError, "backfill audit failed"):
            self.run_backfill()
        self.assertEqual(list(self.conn.iterdump()), before)
        self.assertIsNone(self.conn.execute("SELECT 1 FROM app_settings WHERE key=?", (MARKER,)).fetchone())
        self.conn.execute("DROP TRIGGER fail_second_backfill_audit")
        self.conn.commit()
        self.assertEqual(self.run_backfill()["changed"], 2)
        self.assertEqual(len(self.events("intake_batch.identifiers_backfilled")), 2)


if __name__ == "__main__":
    unittest.main()
