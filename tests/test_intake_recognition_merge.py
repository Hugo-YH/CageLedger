"""Image-first supplements use the real intake transaction and an isolated database."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from server_app import composition
from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.intake import recognition_images
from server_app.domains.intake.recognition_merge import recognition_preview
from server_app.domains.state import intake_commands
from server_app.persistence.bootstrap import initialize_schema
from server_app.repositories.entities import upsert_intake_batch
from server_app.shared.concurrency import StaleWriteError
from server_app.shared.sqlite import ClosingConnection
from server_app.web.intake_recognition_merge import intake_recognition_preview_handler
from tests.test_intake_duplicates import ACTOR, batch
from tests.test_intake_recognition_images import image_input


class RecognitionMergeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "merge.sqlite"
        with self.connect() as conn, patch("server_app.persistence.bootstrap.ensure_seed_images"):
            initialize_schema(conn)
        for target, attr, value in (
            (intake_commands, "connect_db", self.connect),
            (recognition_images, "INTAKE_RECOGNITION_IMAGES_PATH", Path(self.temp.name) / "images"),
        ):
            p = patch.object(target, attr, value)
            p.start()
            self.addCleanup(p.stop)
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")
        self.incoming = {
            "rawMessage": "需求预约，2026年11月6日送货，数量999只。",
            "batchNo": "（Z2026001）2026102101",
            "purchaseOrderNo": "C20261021001",
            "intakeDate": "2026-11-06",
            "quantity": 999,
            "sex": "雄性",
            "pi": "文字中的错误负责人",
        }

    def connect(self):
        conn = sqlite3.connect(self.path, factory=ClosingConnection)
        conn.row_factory = sqlite3.Row
        return conn

    def save(self, item, actor=ACTOR, **options):
        exists = options.pop("exists", False)
        return composition.write_intake_batch_entity_state(
            "PUT" if exists else "POST",
            item["id"] if exists else None,
            {"item": item, **options},
            actor,
            {"id_prefix": "batch"},
        )[0]["item"]

    def original(self, **overrides):
        item = batch(
            "original",
            intakeDate="",
            rawMessage="原图片预约",
            husbandryMonths=2,
            husbandryDays=None,
            endDate="",
            sex="雌性",
            **overrides,
        )
        item["recognition"] = {
            "extractedText": "原图片识别依据",
            "fieldSources": {"quantity": "采购图5只"},
            "warnings": [],
            "model": "original-image-model",
        }
        return self.save(item, recognitionImages=[image_input()])

    def preview(self, incoming=None):
        with self.connect() as conn:
            conn.execute("PRAGMA query_only=ON")
            conn.execute("BEGIN")
            return recognition_preview(conn, ACTOR, {"item": incoming or self.incoming})

    def snapshot(self):
        with self.connect() as conn:
            return (
                [tuple(r) for r in conn.execute("SELECT * FROM intake_batches ORDER BY id")],
                [tuple(r) for r in conn.execute("SELECT * FROM audit_events ORDER BY rowid")],
            )

    def merge(self, candidate, incoming=None, actor=ACTOR, **options):
        request = {"incoming": incoming or self.incoming, "confirmationToken": candidate["confirmationToken"]}
        return self.save(
            candidate["mergedItem"] or candidate["item"],
            actor=actor,
            exists=True,
            checkDuplicates=True,
            expectedUpdatedAt=candidate["item"]["updatedAt"],
            recognitionMerge=request,
            **options,
        )

    def test_preview_is_read_only_preserves_images_and_uses_image_values_and_calendar_months(self):
        original = self.original()
        before = self.snapshot()
        candidate = self.preview()["items"][0]
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(candidate["classification"], "same_pair")
        self.assertTrue(candidate["canMerge"])
        item = candidate["mergedItem"]
        self.assertEqual((item["quantity"], item["sex"], item["pi"]), (5, "雌性", original["pi"]))
        self.assertEqual((item["intakeDate"], item["endDate"], item["husbandryDays"]), ("2026-11-06", "2027-01-06", 61))
        for field in ("id", "updatedAt", "status"):
            self.assertEqual(item[field], original[field])
        self.assertEqual(item["recognition"]["images"], original["recognition"]["images"])
        self.assertEqual(item["recognition"]["fieldSources"]["quantity"], "采购图5只")

    def test_confirm_updates_one_record_ignores_forged_item_and_records_merge_audit(self):
        original = self.original()
        candidate = self.preview()["items"][0]
        candidate["mergedItem"]["quantity"] = 888
        candidate["mergedItem"]["status"] = "received"
        candidate["mergedItem"]["recognition"]["images"] = []
        saved = self.merge(candidate)
        self.assertEqual(saved["quantity"], 5)
        self.assertEqual(saved["status"], original["status"])
        self.assertEqual(saved["recognition"]["images"], original["recognition"]["images"])
        self.assertEqual(saved["recognition"]["model"], "original-image-model")
        self.assertEqual(saved["recognition"]["textSupplements"][0]["rawMessage"], self.incoming["rawMessage"])
        self.assertIn("原图片预约", saved["rawMessage"])
        self.assertIn(self.incoming["rawMessage"], saved["rawMessage"])
        self.assertEqual(len(self.snapshot()[0]), 1)
        with self.connect() as conn:
            events = [
                json.loads(r[0])
                for r in conn.execute("SELECT payload FROM audit_events WHERE action='intake_batch.recognition_merged'")
            ]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["actorUserId"], ACTOR["id"])
        self.assertEqual(events[0]["entityId"], original["id"])
        self.assertEqual(events[0]["after"]["rawMessage"], self.incoming["rawMessage"])
        retained = self.save(saved, exists=True, expectedUpdatedAt=saved["updatedAt"])
        self.assertEqual(retained["recognition"]["textSupplements"], saved["recognition"]["textSupplements"])

    def test_normalized_pair_and_single_known_identifier_can_match(self):
        self.original()
        for values, kind in (
            ({"batchNo": " ( Z2026001 )2026102101 ", "purchaseOrderNo": "c20261021001"}, "same_pair"),
            ({"purchaseOrderNo": ""}, "batch_only"),
            ({"batchNo": ""}, "purchase_only"),
        ):
            with self.subTest(values=values):
                result = self.preview({**self.incoming, **values})["items"][0]
                self.assertEqual(result["classification"], kind)
                self.assertTrue(result["canMerge"])

    def test_same_demand_other_order_or_same_order_other_demand_is_conflict(self):
        self.original()
        for values in ({"purchaseOrderNo": "C-OTHER"}, {"batchNo": "B-OTHER"}):
            candidate = self.preview({**self.incoming, **values})["items"][0]
            self.assertEqual(candidate["classification"], "association_conflict")
            self.assertFalse(candidate["canMerge"])
            self.assertIsNone(candidate["mergedItem"])

    def test_multiple_matches_and_late_new_matching_record_disable_merge_without_writes(self):
        self.original()
        candidate = self.preview()["items"][0]
        self.save(batch("second", purchaseOrderNo="OTHER"))
        before = self.snapshot()
        result = self.preview()
        self.assertEqual(result["total"], 2)
        self.assertTrue(all(not item["canMerge"] for item in result["items"]))
        with self.assertRaises(StaleWriteError):
            self.merge(candidate)
        self.assertEqual(self.snapshot(), before)

    def test_version_token_incoming_changes_and_missing_version_are_rejected(self):
        original = self.original()
        candidate = self.preview()["items"][0]
        before = self.snapshot()
        for change in ({"rawMessage": "另一天预约"}, {"intakeDate": "2026-11-07"}):
            with self.assertRaises(StaleWriteError):
                self.merge(candidate, {**self.incoming, **change})
            self.assertEqual(self.snapshot(), before)
        with self.assertRaises(StaleWriteError):
            self.save(
                candidate["mergedItem"],
                exists=True,
                recognitionMerge={"incoming": self.incoming, "confirmationToken": candidate["confirmationToken"]},
            )
        self.save({**original, "notes": "其他人编辑"}, exists=True)
        before = self.snapshot()
        with self.assertRaises(StaleWriteError):
            self.merge(candidate)
        self.assertEqual(self.snapshot(), before)

    def test_received_and_text_only_records_are_visible_but_not_mergeable(self):
        self.save(batch("text-only"))
        self.assertIn("未留存图片", self.preview()["items"][0]["reason"])
        with self.connect() as conn:
            conn.execute("DELETE FROM intake_batches")
        original = self.original()
        with self.connect() as conn:
            upsert_intake_batch(conn, {**original, "status": "received"})
        self.assertIn("已接收", self.preview()["items"][0]["reason"])

    def test_descriptive_orders_do_not_match_and_no_identifier_has_no_candidates(self):
        self.original()
        for fields in (
            {"batchNo": "", "purchaseOrderNo": "不走锐竞"},
            {"batchNo": "", "purchaseOrderNo": "N/A"},
            {"batchNo": "", "purchaseOrderNo": ""},
        ):
            self.assertEqual(self.preview({**self.incoming, **fields}), {"items": [], "total": 0})

    def test_direct_sampling_supplement_keeps_no_cage_or_husbandry_fields(self):
        original = self.original(intakePurpose="direct_sampling", status="pending_receipt")
        candidate = self.preview({**self.incoming, "roomName": "错误房间", "finalCardCount": 20, "husbandryDays": 50})[
            "items"
        ][0]
        saved = candidate["mergedItem"]
        for field in ("roomName", "finalCardCount", "husbandryMonths", "husbandryDays", "endDate"):
            self.assertEqual(saved.get(field), original.get(field))
        self.assertEqual(saved["intakeDate"], "2026-11-06")

    def test_original_day_period_is_not_replaced_by_text_month_period(self):
        original = self.original()
        original["husbandryMonths"] = None
        original["husbandryDays"] = 28
        self.save(original, exists=True)
        result = self.preview({**self.incoming, "husbandryMonths": 3, "husbandryDays": 90, "endDate": "2027-02-06"})[
            "items"
        ][0]["mergedItem"]
        self.assertIsNone(result["husbandryMonths"])
        self.assertEqual((result["husbandryDays"], result["endDate"]), (28, "2026-12-04"))

    def test_merge_preserves_room_permission_and_audit_failure_rolls_back_all(self):
        self.original()
        candidate = self.preview()["items"][0]
        before = self.snapshot()
        with self.assertRaises(PermissionError):
            self.merge(candidate, actor={**ACTOR, "role": "room_admin", "roomIds": []})
        self.assertEqual(self.snapshot(), before)
        with patch.object(intake_commands, "write_audit_events", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaisesRegex(RuntimeError, "audit unavailable"):
                self.merge(candidate)
        self.assertEqual(self.snapshot(), before)
        saved = self.merge(candidate, actor={**ACTOR, "role": "room_admin", "roomIds": ["authorized-room"]})
        self.assertEqual(saved["intakeDate"], "2026-11-06")
        before = self.snapshot()
        with self.assertRaises(StaleWriteError):
            self.merge(candidate)
        self.assertEqual(self.snapshot(), before)

    def test_zero_card_count_requiring_review_is_not_replaced_by_a_text_default(self):
        self.original(finalCardCount=0)
        candidate = self.preview({**self.incoming, "finalCardCount": 17})["items"][0]
        self.assertTrue(candidate["canMerge"])
        self.assertEqual(candidate["mergedItem"]["finalCardCount"], 0)
        change = next(row for row in candidate["changes"] if row["field"] == "finalCardCount")
        self.assertEqual((change["after"], change["source"]), (0, "image"))

    def test_read_adapter_requires_login_and_never_writes(self):
        handler = Mock()
        handler.current_user.return_value = None
        self.assertEqual(intake_recognition_preview_handler(handler, {}).status, 401)
        handler.current_user.return_value = ACTOR
        handler.read_json_body.return_value = {"item": self.incoming}
        self.original()
        before = self.snapshot()
        with patch("server_app.web.intake_recognition_merge.connect_db", self.connect):
            result = intake_recognition_preview_handler(handler, {})
        self.assertEqual(result.status, 200)
        self.assertEqual(self.snapshot(), before)
