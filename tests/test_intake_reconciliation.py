"""Unified review: same records are read-only; supplements preserve identity and provenance."""

import copy
import hashlib
import json
from pathlib import Path
from unittest import TestCase
from unittest.mock import Mock, patch

from server_app.domains.intake import recognition_images
from server_app.domains.intake.duplicates import IntakeDuplicateConfirmationRequired
from server_app.domains.intake.recognition_evidence import sanitize_evidence
from server_app.domains.intake.recognition_merge import recognition_preview
from server_app.domains.intake.recognition_uploads import UploadExpired
from server_app.domains.state import intake_commands
from server_app.repositories.audit_storage import read_payload
from server_app.repositories.entities import upsert_intake_batch
from server_app.shared.concurrency import StaleWriteError
from server_app.web.intake_recognition_merge import intake_recognition_preview_handler
from tests import test_intake_recognition_merge as legacy_fixture
from tests.test_intake_duplicates import ACTOR, batch
from tests.test_intake_recognition_images import image_input


class IntakeReconciliationTests(TestCase):
    connect = legacy_fixture.RecognitionMergeTests.connect
    save = legacy_fixture.RecognitionMergeTests.save
    snapshot = legacy_fixture.RecognitionMergeTests.snapshot

    def setUp(self):
        legacy_fixture.RecognitionMergeTests.setUp(self)

    def original(self, *, image=False, **fields):
        item = batch(
            "original",
            **{"strainRaw": "ICR", "strainStandard": "ICR", "specification": "6-8w", "rawMessage": "原预约", **fields},
        )
        return self.save(item, recognitionImages=[image_input()] if image else [])

    def incoming_item(self, original, images=(), **fields):
        item = {**copy.deepcopy(original), "recognition": {}, **fields}
        if images:
            decoded = recognition_images.decode_images(list(images))
            item["recognition"] = {
                "model": "test-image-model",
                "inputImages": [
                    {"name": value.name, "sha256": hashlib.sha256(value.body).hexdigest()} for value in decoded
                ],
            }
        return item

    def preview(self, incoming, images=(), **options):
        with self.connect() as conn:
            conn.execute("PRAGMA query_only=ON")
            conn.execute("BEGIN")
            return recognition_preview(
                conn, ACTOR, {"reviewVersion": 2, "item": incoming, "recognitionImages": list(images), **options}
            )

    def supplement(self, candidate, incoming, images=(), **options):
        return self.save(
            candidate["mergedItem"] or candidate["item"],
            exists=True,
            checkDuplicates=True,
            recognitionImages=list(images),
            expectedUpdatedAt=candidate["item"]["updatedAt"],
            recognitionMerge={
                "reviewVersion": 2,
                "incoming": incoming,
                "confirmationToken": candidate["confirmationToken"],
            },
            **options,
        )

    def test_every_text_image_order_finds_registered_record_without_writes(self):
        for index, (old_image, new_image) in enumerate(((False, False), (False, True), (True, False), (True, True))):
            with self.subTest(old_image=old_image, new_image=new_image):
                original = self.save(
                    batch(
                        f"original-{index}",
                        batchNo=f"B-{index}",
                        purchaseOrderNo=f"C-{index}",
                        strainRaw="ICR",
                        strainStandard="ICR",
                        specification="6-8w",
                        rawMessage="原预约",
                    ),
                    recognitionImages=[image_input()] if old_image else [],
                )
                images = [image_input(name="再识别.png")] if new_image else []
                incoming = self.incoming_item(original, images, rawMessage="" if new_image else "原预约")
                before = self.snapshot()
                result = self.preview(incoming, images)
                self.assertEqual(result["outcome"], "registered")
                self.assertTrue(result["items"][0]["canAcknowledge"])
                self.assertEqual(result["items"][0]["item"]["id"], original["id"])
                self.assertEqual(self.snapshot(), before)

    def test_animal_differences_and_missing_values_are_not_equal(self):
        original = self.original()
        for fields, field, status in (
            ({"quantity": 30}, "quantity", "different"),
            ({"strainStandard": "C57BL/6J", "strainRaw": "C57BL/6J"}, "strainStandard", "different"),
            ({"specification": "8-10w"}, "specification", "different"),
            ({"quantity": None}, "quantity", "missing"),
            ({"specification": "未知规格"}, "specification", "unknown"),
        ):
            with self.subTest(fields=fields):
                result = self.preview(self.incoming_item(original, **fields))
                candidate = result["items"][0]
                self.assertFalse(candidate["canAcknowledge"])
                self.assertEqual(
                    next(row["status"] for row in candidate["comparisons"] if row["field"] == field), status
                )
                if status in ("different", "unknown"):
                    self.assertFalse(candidate["canMerge"])
        equivalent = self.preview(
            self.incoming_item(original, strainRaw="ICR小鼠", strainStandard="ICR小鼠", specification="6～8周龄")
        )
        self.assertEqual(equivalent["outcome"], "registered")

    def test_current_source_conflicts_survive_purchase_priority_and_text_comparison(self):
        original = self.original()
        incoming = self.incoming_item(original)
        incoming["recognition"] = {
            "sources": [
                {"imageIndex": 1, "kind": "husbandry", "quantity": 9, "strainRaw": "ICR", "specification": "6-8w"},
                {"imageIndex": 2, "kind": "purchase", "quantity": 5, "strainRaw": "ICR", "specification": "6-8w"},
            ]
        }
        result = self.preview(incoming)
        self.assertEqual(result["outcome"], "conflict")
        self.assertTrue(any(row["field"] == "quantity" for row in result["sourceIssues"]))
        self.assertFalse(result["items"][0]["canAcknowledge"])
        incoming["recognition"]["sources"] = incoming["recognition"]["sources"][1:]
        incoming["rawMessage"] = "数量：30只\n品系：ICR\n规格：6-8周龄"
        self.assertTrue(any(row["field"] == "quantity" for row in self.preview(incoming)["sourceIssues"]))

    def test_selected_unrecognized_images_block_false_registered_result(self):
        original = self.original()
        incoming = self.incoming_item(original)
        result = self.preview(incoming, [image_input()])
        self.assertEqual(result["outcome"], "conflict")
        self.assertEqual(result["sourceIssues"][0]["field"], "recognition")
        self.assertFalse(result["items"][0]["canMerge"])

    def test_unknown_strain_and_incomplete_identifier_set_never_confirm_registered(self):
        original = self.original(strainRaw="未收录测试品系XYZ", strainStandard="未收录测试品系XYZ")
        candidate = self.preview(self.incoming_item(original))["items"][0]
        self.assertEqual(candidate["reviewStatus"], "insufficient")
        self.assertFalse(candidate["canAcknowledge"])
        self.assertFalse(candidate["canMerge"])
        with self.connect() as conn:
            upsert_intake_batch(conn, {**original, "strainRaw": "ICR", "strainStandard": "ICR"})
        candidate = self.preview(
            self.incoming_item({**original, "strainRaw": "ICR", "strainStandard": "ICR"}, purchaseOrderNo="")
        )["items"][0]
        self.assertFalse(candidate["canAcknowledge"])

    def test_same_kind_image_conflicts_and_text_without_sources_are_not_hidden(self):
        original = self.original()
        for field, changed in (("strainRaw", "C57BL/6J"), ("specification", "9-10w")):
            with self.subTest(field=field):
                first = {
                    "imageIndex": 1,
                    "kind": "purchase",
                    "quantity": 5,
                    "strainRaw": "ICR",
                    "specification": "6-8w",
                }
                second = {**first, "imageIndex": 2, field: changed}
                incoming = self.incoming_item(original)
                incoming["recognition"] = {"sources": [first, second]}
                result = self.preview(incoming)
                self.assertEqual(result["outcome"], "conflict")
                self.assertFalse(result["items"][0]["canAcknowledge"])
        result = self.preview(self.incoming_item(original, rawMessage="数量：99只"))
        self.assertEqual(result["outcome"], "conflict")
        self.assertTrue(any(row["field"] == "quantity" for row in result["sourceIssues"]))

    def test_excluding_edited_record_only_hides_it_and_keeps_confirmation_token_valid(self):
        original = self.original(purchaseOrderNo="C2026102648086", orderNo="DC202610264808601")
        second = self.save(
            {**original, "id": "second", "batchNo": "SECOND", "orderNo": "DC202610264808602", "cards": []}
        )
        incoming = self.incoming_item(second, rawMessage="补充原文")
        result = self.preview(incoming, excludeId=original["id"])
        self.assertEqual(result["total"], 1)
        saved = self.supplement(result["items"][0], incoming)
        self.assertIn("补充原文", saved["rawMessage"])
        self.assertEqual(saved["id"], "second")

    def test_shared_purchase_distinct_orders_do_not_hide_unique_precise_record(self):
        original = self.original(purchaseOrderNo="C2026102648086", orderNo="DC202610264808601")
        self.save(
            batch("other", purchaseOrderNo=original["purchaseOrderNo"], orderNo="DC202610264808602", batchNo="OTHER")
        )
        result = self.preview(self.incoming_item(original))
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["outcome"], "registered")
        self.assertEqual(result["items"][0]["item"]["id"], original["id"])
        self.assertFalse(result["items"][1]["canAcknowledge"])
        conflicting = self.preview(self.incoming_item(original, orderNo="DC202610264808603"))
        self.assertTrue(all(not row["canAcknowledge"] and not row["canMerge"] for row in conflicting["items"]))

    def test_image_supplement_to_text_record_preserves_cards_and_separates_rounds(self):
        original = self.original()
        images = [image_input("blue")]
        incoming = self.incoming_item(original, images, rawMessage="新增原图")
        candidate = self.preview(incoming, images)["items"][0]
        candidate["mergedItem"].update(quantity=888, status="received", cards=[])
        saved = self.supplement(candidate, incoming, images)
        self.assertEqual(
            (saved["id"], saved["quantity"], saved["status"], saved["cards"]),
            (original["id"], original["quantity"], original["status"], original["cards"]),
        )
        evidence = saved["recognition"]
        self.assertEqual(len(evidence["images"]), 1)
        round_ = evidence["recognitionRounds"][0]
        self.assertEqual(round_["imageIds"], [evidence["images"][0]["id"]])
        self.assertEqual(round_["evidence"]["model"], "test-image-model")
        retained = self.save(saved, exists=True, expectedUpdatedAt=saved["updatedAt"])
        self.assertEqual(retained["recognition"]["recognitionRounds"], evidence["recognitionRounds"])
        self.assertEqual(sanitize_evidence(evidence)["recognitionRounds"], evidence["recognitionRounds"])
        renamed = [image_input("blue", name="换名字.png")]
        duplicate = self.incoming_item(retained, renamed, rawMessage="新增原图")
        candidate = self.preview(duplicate, renamed)["items"][0]
        self.assertEqual(candidate["reviewStatus"], "registered")
        self.assertFalse(candidate["canMerge"])

    def test_old_round_and_image_mapping_survive_new_image_supplement(self):
        original = self.original(image=True)
        images = [image_input("blue")]
        incoming = self.incoming_item(original, images, rawMessage="补充蓝图")
        saved = self.supplement(self.preview(incoming, images)["items"][0], incoming, images)
        self.assertEqual(saved["recognition"]["imageIds"], original["recognition"]["imageIds"])
        self.assertEqual(saved["recognition"]["model"], original["recognition"]["model"])
        self.assertEqual(
            saved["recognition"]["recognitionRounds"][0]["imageIds"], [saved["recognition"]["images"][1]["id"]]
        )

    def test_missing_date_supplement_keeps_zero_card_count_and_calendar_period(self):
        original = self.original(finalCardCount=0, intakeDate="", husbandryMonths=2, husbandryDays=None, endDate="")
        incoming = self.incoming_item(original, intakeDate="2026-11-06", finalCardCount=4)
        candidate = self.preview(incoming)["items"][0]
        saved = self.supplement(candidate, incoming)
        self.assertEqual((saved["finalCardCount"], saved["cards"]), (0, []))
        self.assertEqual((saved["endDate"], saved["husbandryDays"]), ("2027-01-06", 61))
        with self.connect() as conn:
            event_id = conn.execute(
                "SELECT id FROM audit_events WHERE action='intake_batch.recognition_merged' ORDER BY rowid DESC LIMIT 1"
            ).fetchone()[0]
            changes = json.loads(read_payload(conn, event_id))["after"]["changes"]
        self.assertEqual(next(row["source"] for row in changes if row["field"] == "intakeDate"), "text")

    def test_received_and_partial_records_can_be_acknowledged_but_not_supplemented(self):
        original = self.original()
        for fields in ({"status": "received"}, {"receipts": [{"id": "partial", "cardCount": 0}]}):
            with self.connect() as conn:
                upsert_intake_batch(conn, {**original, **fields})
            result = self.preview(self.incoming_item(original, rawMessage="新文字"))["items"][0]
            self.assertTrue(result["canAcknowledge"])
            self.assertFalse(result["canMerge"])

    def test_tokens_bind_version_full_match_set_input_and_image_identity(self):
        original = self.original()
        incoming = self.incoming_item(original, rawMessage="补充来源")
        candidate = self.preview(incoming)["items"][0]
        before = self.snapshot()
        with self.assertRaises(StaleWriteError):
            self.supplement(candidate, {**incoming, "rawMessage": "改了内容"})
        self.assertEqual(self.snapshot(), before)
        self.save(batch("second", strainStandard="ICR", specification="6-8w"))
        before = self.snapshot()
        with self.assertRaises(StaleWriteError):
            self.supplement(candidate, incoming)
        self.assertEqual(self.snapshot(), before)

    def test_image_identity_and_room_permission_failures_leave_no_business_or_file_changes(self):
        original = self.original(image=True)
        blue = [image_input("blue")]
        incoming = self.incoming_item(original, blue)
        candidate = self.preview(incoming, blue)["items"][0]
        before = self.snapshot()
        directory = Path(self.temp.name) / "images"
        files = {path.name for path in directory.iterdir()}
        with self.assertRaises(StaleWriteError):
            self.supplement(candidate, incoming, [image_input("green")])
        with self.assertRaises(PermissionError):
            self.supplement(candidate, incoming, blue, actor={**ACTOR, "role": "room_admin", "roomIds": []})
        self.assertEqual(self.snapshot(), before)
        self.assertEqual({path.name for path in directory.iterdir()}, files)
        saved = self.supplement(
            candidate, incoming, blue, actor={**ACTOR, "role": "room_admin", "roomIds": ["authorized-room"]}
        )
        rounds = copy.deepcopy(saved["recognition"]["recognitionRounds"])
        forged = copy.deepcopy(saved)
        forged["recognition"]["recognitionRounds"] = [{"at": "forged", "imageIds": ["a" * 32], "evidence": {}}]
        retained = self.save(forged, exists=True, expectedUpdatedAt=saved["updatedAt"])
        self.assertEqual(retained["recognition"]["recognitionRounds"], rounds)

    def test_audit_failure_rolls_back_business_and_owned_image_files(self):
        original = self.original(image=True)
        images = [image_input("blue")]
        incoming = self.incoming_item(original, images)
        candidate = self.preview(incoming, images)["items"][0]
        before = self.snapshot()
        directory = Path(self.temp.name) / "images"
        paths = {path.name: path.read_bytes() for path in directory.iterdir()}
        with patch.object(intake_commands, "write_audit_events", side_effect=RuntimeError("audit failed")):
            with self.assertRaisesRegex(RuntimeError, "audit failed"):
                self.supplement(candidate, incoming, images)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual({path.name: path.read_bytes() for path in directory.iterdir()}, paths)

    def test_late_duplicate_save_returns_same_full_review_not_only_identifier_summary(self):
        original = self.original()
        before = self.snapshot()
        with self.assertRaises(IntakeDuplicateConfirmationRequired) as caught:
            self.save({**original, "id": "new"}, checkDuplicates=True, reviewVersion=2)
        review = caught.exception.details["review"]
        self.assertEqual(review["outcome"], "registered")
        self.assertTrue(any(row["field"] == "quantity" for row in review["items"][0]["comparisons"]))
        self.assertEqual(self.snapshot(), before)

    def test_review_http_auth_and_expired_upload_contract(self):
        handler = Mock()
        handler.current_user.return_value = None
        self.assertEqual(intake_recognition_preview_handler(handler, {}).status, 401)
        handler.current_user.return_value = ACTOR
        handler.read_json_body.return_value = {"reviewVersion": 2, "item": batch("draft")}
        with (
            patch("server_app.web.intake_recognition_merge.connect_db", self.connect),
            patch("server_app.domains.intake.recognition_uploads.request_images", side_effect=UploadExpired()),
        ):
            response = intake_recognition_preview_handler(handler, {})
        self.assertEqual(response.status, 410)
        self.assertEqual(response.payload["code"], "INTAKE_UPLOAD_EXPIRED")
