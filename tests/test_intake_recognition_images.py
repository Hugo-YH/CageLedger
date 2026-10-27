import base64
import copy
import hashlib
import json
import sqlite3
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock, patch

from PIL import Image

from server_app import composition
from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.intake import recognition_images
from server_app.domains.intake.ai_parse import ai_parse_intake_images
from server_app.domains.intake.duplicates import IntakeDuplicateConfirmationRequired
from server_app.domains.intake.recognition_evidence import structure_image_sources
from server_app.domains.state import intake_commands
from server_app.persistence.bootstrap import initialize_schema
from server_app.repositories.audit_storage import read_payload
from server_app.services.ai import deepseek_chat_json
from server_app.shared.concurrency import StaleWriteError
from server_app.shared.sqlite import ClosingConnection
from server_app.web.intake_ai import intake_ai_parse_handler

ACTOR = {"id": "image-admin", "username": "image-admin", "displayName": "测试管理员", "role": "admin"}


def image_input(color="red", name="预约.png"):
    buffer = BytesIO()
    Image.new("RGB", (12, 12), color).save(buffer, format="PNG")
    return {"name": name, "dataUrl": "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()}


def sample_result():
    return {
        "purchaseOrderNo": "C2026102648086",
        "batchNo": "（Z2026108）2026102609",
        "iacuc": "Z2026108",
        "supplier": "江苏集萃药康生物科技股份有限公司",
        "strainRaw": "ICR",
        "species": "mouse",
        "sex": "雄性",
        "quantity": 24,
        "maleQuantity": 24,
        "femaleQuantity": 0,
        "roomName": "8101",
        "intakeDate": "2026-10-26",
        "husbandryDays": 28,
        "finalCardCount": 4,
        "recognition": {
            "extractedText": "本次申请24只雄性ICR；饲养4周，8101，4笼",
            "warnings": [],
            "fieldSources": {
                "intakeDate": "图1 采购申请日期：2026-10-26",
                "finalCardCount": "图2 审核备注：饲养4周，8101，4笼",
            },
        },
        "imageSources": [
            {"batchNo": "（Z2026108）2026102609", "iacuc": "Z2026108", "age": "6-8个月"},
            {"batchNo": "(Z2026108)2026102609", "iacuc": "z2026108", "age": "2-6月"},
        ],
    }


def batch(identity="new-batch"):
    return {
        "id": identity,
        "batchNo": "（Z2026108）2026102609",
        "purchaseOrderNo": "C2026102648086",
        "iacuc": "Z2026108",
        "supplier": "测试供应商",
        "pi": "测试负责人",
        "owner": "测试预约人",
        "quantity": 24,
        "finalCardCount": 4,
        "roomName": "测试房间",
        "intakeDate": "2026-10-30",
        "status": "pending_print",
    }


class ImageRecognitionTests(unittest.TestCase):
    def test_standard_image_batch_number_has_no_layout_spaces_but_legacy_comparison_is_unchanged(self):
        result = structure_image_sources(
            {
                "imageSources": [
                    {"kind": "husbandry", "batchNo": "( z2026108 ) 2026102609"},
                    {"kind": "purchase", "batchNo": "（Z2026108）2026102609"},
                ]
            }
        )
        self.assertEqual(result["batchNo"], "（Z2026108）2026102609")
        self.assertTrue(all(source["batchNo"] == result["batchNo"] for source in result["imageSources"]))
        from server_app.shared.intake_identifiers import intake_identifier_key

        self.assertNotEqual(
            intake_identifier_key("（Z2026108） 2026102609", batch=True),
            intake_identifier_key(result["batchNo"], batch=True),
        )

    @patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_purchase_wins_for_three_comparable_fields_and_keeps_all_source_values(self, chat):
        result = sample_result()
        result["imageSources"] = [
            {
                "kind": "husbandry",
                "batchNo": "（Z2026108）2026102609",
                "strainRaw": "C57",
                "quantity": 24,
                "maleQuantity": 24,
                "femaleQuantity": 0,
                "specification": "2-6月",
                "husbandryDays": 28,
                "finalCardCount": 4,
                "roomName": "8101",
                "reviewNotes": "饲养4周，8101，4笼",
            },
            {
                "kind": "purchase",
                "batchNo": "（Z2026108）2026102609",
                "productName": "ICR小鼠",
                "specification": "6-8个月",
                "quantity": 30,
            },
        ]
        chat.return_value = result, {}
        item, _, evidence = ai_parse_intake_images("", [], [image_input(), image_input("blue")])
        self.assertEqual((item["strainStandard"], item["specification"], item["quantity"]), ("ICR", "6-8m", 30))
        self.assertEqual((item["roomName"], item["husbandryDays"], item["finalCardCount"]), ("8101", 28, 4))
        for field in ("动物品系差异", "体重/日龄（规格）差异", "本批数量差异"):
            self.assertTrue(any(field in text and "采购信息" in text for text in evidence["warnings"]))
        self.assertEqual(evidence["sources"][0]["quantity"], 24)
        self.assertEqual(evidence["sources"][1]["quantity"], 30)
        result["imageSources"][0].update(strainRaw="ICR", specification="6-8月", quantity=30, maleQuantity=30)
        _, _, evidence = ai_parse_intake_images("", [], [image_input(), image_input("blue")])
        self.assertFalse(any("品系差异" in text or "体重/日龄（规格）差异" in text for text in evidence["warnings"]))

    def test_unambiguous_purchase_quantity_wins_while_unresolved_husbandry_fields_are_cleared(self):
        payload = {
            "quantity": 24,
            "roomName": "8101",
            "finalCardCount": 4,
            "husbandryDays": 28,
            "imageSources": [
                {"kind": "husbandry", "quantity": 24, "roomName": "8101", "finalCardCount": 4, "husbandryDays": 28},
                {"kind": "husbandry", "quantity": 30, "roomName": "8102", "finalCardCount": 5, "husbandryDays": 35},
                {"kind": "purchase", "quantity": 24},
            ],
        }
        result = structure_image_sources(payload)
        self.assertEqual(result["quantity"], 24)
        self.assertEqual(result["roomName"], "")
        self.assertEqual(result["finalCardCount"], 0)
        self.assertIsNone(result["husbandryDays"])
        for label in ("本批数量", "饲养间", "笼数", "饲养周期"):
            self.assertTrue(any(label in warning for warning in result["recognition"]["warnings"]))

    def test_missing_cage_evidence_is_not_fabricated_from_the_extracted_number(self):
        result = structure_image_sources({"imageSources": [{"kind": "husbandry", "finalCardCount": 4}]})
        self.assertEqual(result["finalCardCount"], 0)
        self.assertNotIn("finalCardCount", result["recognition"]["fieldSources"])

    @patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_roles_keep_approval_quota_separate_and_merge_husbandry_with_purchase(self, chat):
        result = sample_result()
        result.update(quantity=240, finalCardCount=5)
        result["imageSources"] = [
            {
                "imageIndex": 1,
                "kind": "husbandry",
                "iacuc": "Z2026108",
                "batchNo": "（Z2026108）2026102609",
                "approvedQuantity": 240,
                "remainingQuantity": 240,
                "quantity": 24,
                "maleQuantity": 24,
                "femaleQuantity": 0,
                "reviewNotes": "饲养4周，8101，4笼",
                "husbandryDays": 28,
                "roomName": "8101",
                "intakePurpose": "housing",
                "finalCardCount": 4,
                "specification": "2-6月",
            },
            {
                "imageIndex": 2,
                "kind": "purchase",
                "purchaseOrderNo": "C2026102648086",
                "batchNo": "(Z2026108)2026102609",
                "productName": "ICR小鼠",
                "specification": "6-8个月",
                "quantity": 24,
                "supplier": "江苏集萃药康生物科技股份有限公司",
            },
        ]
        chat.return_value = result, {}
        item, _, evidence = ai_parse_intake_images("", [], [image_input(), image_input("blue")])
        self.assertEqual(
            (item["quantity"], item["sex"], item["finalCardCount"], item["husbandryDays"]), (24, "雄性", 4, 28)
        )
        self.assertEqual(evidence["sources"][0]["approvedQuantity"], 240)
        self.assertEqual(evidence["sources"][1]["purchaseOrderNo"], "C2026102648086")
        self.assertFalse(any("批次号信息不一致" in warning for warning in evidence["warnings"]))
        result["imageSources"][1]["quantity"] = 30
        item, _, evidence = ai_parse_intake_images("", [], [image_input(), image_input("blue")])
        self.assertEqual(item["quantity"], 30)
        self.assertEqual(item["specification"], "6-8m")
        self.assertTrue(any("本批数量差异" in text and "采购信息" in text for text in evidence["warnings"]))

    def test_validates_real_bytes_and_sanitizes_names(self):
        result = recognition_images.decode_images([image_input(name="../../原图.png")])[0]
        self.assertEqual(result.name, "原图.png")
        self.assertEqual(result.mime, "image/png")
        self.assertEqual(result.data_url, image_input()["dataUrl"])

    def test_rejects_svg_forged_mime_corrupt_data_and_excess_count(self):
        png = image_input()
        for images in (
            [{"name": "x.svg", "dataUrl": "data:image/svg+xml;base64,PHN2Zy8+"}],
            [{**png, "dataUrl": png["dataUrl"].replace("image/png", "image/jpeg")}],
            [{**png, "dataUrl": "data:image/png;base64,aGVsbG8="}],
            [png] * 5,
            {"bad": "shape"},
        ):
            with self.subTest(images=type(images).__name__), self.assertRaises(ValueError):
                recognition_images.decode_images(images)

    def test_enforces_individual_total_size_and_pixel_limits(self):
        png = image_input()
        with patch.object(recognition_images, "MAX_IMAGE_BYTES", 10), self.assertRaises(ValueError):
            recognition_images.decode_images([png])
        with patch.object(recognition_images, "MAX_TOTAL_BYTES", 100), self.assertRaises(ValueError):
            recognition_images.decode_images([png, png])
        buffer = BytesIO()
        Image.new("RGB", (8193, 1)).save(buffer, format="PNG")
        with self.assertRaisesRegex(ValueError, "尺寸过大"):
            recognition_images.decode_images(
                [{"dataUrl": "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()}]
            )

    @patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_two_image_sample_keeps_24_and_4_cages_with_missing_arrival_and_age_warning(self, chat):
        chat.return_value = sample_result(), {"total_tokens": 123}
        item, usage, evidence = ai_parse_intake_images("", ["8101"], [image_input(), image_input("blue")])
        self.assertEqual((item["quantity"], item["finalCardCount"], item["husbandryDays"]), (24, 4, 28))
        self.assertEqual(item["intakeDate"], "")
        self.assertEqual(item["endDate"], "")
        self.assertEqual(item["iacuc"], "Z2026108")
        self.assertEqual(usage["total_tokens"], 123)
        self.assertTrue(any("申请日期不能代替" in text for text in evidence["warnings"]))
        self.assertTrue(any("日龄不一致" in text for text in evidence["warnings"]))
        self.assertEqual(len(chat.call_args.kwargs["image_urls"]), 2)

    @patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_explicit_arrival_can_calculate_end_date_and_conflicting_identifiers_are_not_merged(self, chat):
        result = sample_result()
        result["recognition"]["fieldSources"]["intakeDate"] = "补充文字 到货日期：2026-10-26"
        chat.return_value = result, {}
        item, _, _ = ai_parse_intake_images("到货日期2026-10-26", [], [image_input()])
        self.assertEqual(item["endDate"], "2026-11-23")
        result["imageSources"][1]["batchNo"] = "（Z2026108）2026102701"
        with self.assertRaisesRegex(ValueError, "不一致"):
            ai_parse_intake_images("", [], [image_input(), image_input("blue")])

    @patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_inconsistent_sex_totals_are_left_for_review_and_no_ai_call_for_invalid_image(self, chat):
        result = sample_result()
        result["quantity"] = 240
        chat.return_value = result, {}
        item, _, evidence = ai_parse_intake_images("", [], [image_input()])
        self.assertIsNone(item["quantity"])
        self.assertTrue(any("数量之和不一致" in text for text in evidence["warnings"]))
        chat.reset_mock()
        with self.assertRaises(ValueError):
            ai_parse_intake_images("", [], [{"dataUrl": "not-image"}])
        chat.assert_not_called()

    @patch("server_app.services.ai.DEEPSEEK_API_KEY", "fake-test-key")
    @patch("server_app.services.ai.urlopen")
    def test_transport_uses_vision_model_and_image_blocks_without_changing_plain_text_shape(self, urlopen):
        urlopen.return_value.__enter__.return_value.read.return_value = (
            b'{"choices":[{"message":{"content":"{\\"ok\\":true}"}}]}'
        )
        result, _ = deepseek_chat_json("rules", "text", image_urls=[image_input()["dataUrl"]], model="vision-test")
        self.assertEqual(result, {"ok": True})
        body = json.loads(urlopen.call_args.args[0].data)
        self.assertEqual(body["model"], "vision-test")
        self.assertEqual(body["messages"][1]["content"][1]["type"], "image_url")
        deepseek_chat_json("rules", "text")
        body = json.loads(urlopen.call_args.args[0].data)
        self.assertEqual(body["messages"][1]["content"], "text")
        self.assertNotIn("thinking", body)

    def test_handler_rejects_anonymous_and_malformed_body_and_keeps_legacy_response(self):
        handler = Mock()
        handler.current_user.return_value = None
        self.assertEqual(intake_ai_parse_handler(handler, {}).status, 401)
        handler.read_json_body.assert_not_called()
        handler.current_user.return_value = ACTOR
        handler.read_json_body.return_value = []
        self.assertEqual(intake_ai_parse_handler(handler, {}).status, 400)
        handler.read_json_body.return_value = {"rawMessage": "legacy"}
        with patch("server_app.web.intake_ai.ai_parse_intake_message", return_value=({"quantity": 1}, {})):
            self.assertEqual(intake_ai_parse_handler(handler, {}).payload, {"item": {"quantity": 1}, "usage": {}})


class ImagePersistenceTests(unittest.TestCase):
    def test_calendar_month_save_and_date_edits_preserve_values_in_sqlite_and_audit(self):
        item = {
            **batch("calendar"),
            "intakeDate": "2026-01-31",
            "husbandryMonths": 1,
            "husbandryDays": 99,
            "endDate": "2026-05-01",
        }
        saved = self.save(item)
        self.assertEqual((saved["endDate"], saved["husbandryDays"]), ("2026-02-28", 28))
        edited = self.save({**saved, "intakeDate": "2026-10-26"}, editing=True, expectedUpdatedAt=saved["updatedAt"])
        self.assertEqual((edited["endDate"], edited["husbandryDays"], edited["husbandryMonths"]), ("2026-11-26", 31, 1))
        with self.connect() as conn:
            stored = json.loads(
                conn.execute("SELECT payload FROM intake_batches WHERE id=?", (saved["id"],)).fetchone()[0]
            )
            self.assertEqual(
                (stored["endDate"], stored["husbandryDays"], stored["husbandryMonths"]), ("2026-11-26", 31, 1)
            )
            event = conn.execute(
                "SELECT id FROM audit_events WHERE entity_id=? ORDER BY rowid DESC LIMIT 1", (saved["id"],)
            ).fetchone()
            audited = json.loads(read_payload(conn, event["id"]))
            self.assertEqual((audited["after"]["husbandryMonths"], audited["after"]["husbandryDays"]), (1, 31))

    def test_old_edit_without_months_preserves_unchanged_intent_but_respects_explicit_day_edits(self):
        saved = self.save({**batch("calendar-old"), "intakeDate": "2026-01-31", "husbandryMonths": 1})
        old = {key: value for key, value in saved.items() if key != "husbandryMonths"}
        updated = self.save({**old, "supplier": "新供应商"}, editing=True, expectedUpdatedAt=saved["updatedAt"])
        self.assertEqual(updated["husbandryMonths"], 1)
        old.update(husbandryDays=10, endDate="2026-02-10")
        manual = self.save(old, editing=True, expectedUpdatedAt=updated["updatedAt"])
        self.assertIsNone(manual["husbandryMonths"])
        self.assertEqual((manual["endDate"], manual["husbandryDays"]), ("2026-02-10", 10))

    def test_explicitly_cleared_months_and_legacy_batches_remain_compatible(self):
        saved = self.save({**batch("calendar-clear"), "intakeDate": "2026-01-31", "husbandryMonths": 1})
        manual = self.save(
            {**saved, "husbandryMonths": None, "husbandryDays": 10, "endDate": "2026-02-10"},
            editing=True,
            expectedUpdatedAt=saved["updatedAt"],
        )
        self.assertIsNone(manual["husbandryMonths"])
        self.assertEqual((manual["endDate"], manual["husbandryDays"]), ("2026-02-10", 10))
        self.assertNotIn("husbandryMonths", self.save(batch("legacy-no-calendar")))

    def test_changed_upload_cannot_be_attached_as_the_original_of_an_earlier_recognition(self):
        item = batch()
        original = image_input()
        original_hash = hashlib.sha256(base64.b64decode(original["dataUrl"].split(",")[1])).hexdigest()
        item["recognition"] = {
            "inputImages": [{"name": original["name"], "sha256": original_hash}],
            "sources": [{"imageIndex": 1, "kind": "husbandry", "quantity": 24}],
        }
        saved = self.save(item, recognitionImages=[image_input("blue")])
        self.assertEqual(saved["recognition"]["imageIds"], [""])
        self.assertTrue(any("未留档" in warning for warning in saved["recognition"]["warnings"]))
        self.assertEqual(len(saved["recognition"]["images"]), 1)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "copy.sqlite"
        self.images = Path(self.directory.name) / "images"
        for target, name, value in (
            (intake_commands, "connect_db", self.connect),
            (recognition_images, "INTAKE_RECOGNITION_IMAGES_PATH", self.images),
        ):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        with self.connect() as conn:
            initialize_schema(conn)
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")

    def connect(self):
        connection = sqlite3.connect(self.path, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    def save(self, item, *, editing=False, **options):
        return composition.write_intake_batch_entity_state(
            "PUT" if editing else "POST",
            item["id"] if editing else None,
            {"item": item, **options},
            ACTOR,
            {"id_prefix": "batch"},
        )[0]["item"]

    def stored_files(self):
        return list(self.images.glob("*")) if self.images.exists() else []

    def test_success_stores_bytes_metadata_and_transactional_audit_without_base64(self):
        item = batch()
        item["recognition"] = {"extractedText": "24只，4笼", "warnings": [], "fieldSources": {"quantity": "申请数量24"}}
        saved = self.save(item, recognitionImages=[image_input()])
        self.assertEqual(len(self.stored_files()), 1)
        meta = saved["recognition"]["images"][0]
        self.assertEqual(saved["recognition"]["imageIds"], [meta["id"]])
        with self.connect() as conn:
            content, name, mime = recognition_images.read_image(conn, item["id"], meta["id"])
            self.assertEqual(content, base64.b64decode(image_input()["dataUrl"].split(",")[1]))
            self.assertEqual((name, mime), ("预约.png", "image/png"))
            self.assertNotIn("data:image", conn.execute("SELECT payload FROM intake_batches").fetchone()[0])
            events = conn.execute("SELECT id,action FROM audit_events WHERE entity_id=?", (item["id"],)).fetchall()
            self.assertIn("intake_batch.recognition_images_added", [row["action"] for row in events])
            for row in events:
                self.assertNotIn("dataUrl", read_payload(conn, row["id"]))

    def test_same_bytes_with_different_source_names_keep_both_document_positions(self):
        saved = self.save(
            batch(), recognitionImages=[image_input(name="饲养需求.png"), image_input(name="采购信息.png")]
        )
        self.assertEqual([image["name"] for image in saved["recognition"]["images"]], ["饲养需求.png", "采购信息.png"])
        self.assertEqual(len(self.stored_files()), 2)
        updated = self.save(
            saved,
            editing=True,
            expectedUpdatedAt=saved["updatedAt"],
            recognitionImages=[
                image_input("blue", "新采购.png"),
                image_input(name="饲养需求.png"),
            ],
        )
        by_name = {image["name"]: image["id"] for image in updated["recognition"]["images"]}
        self.assertEqual(updated["recognition"]["imageIds"], [by_name["新采购.png"], by_name["饲养需求.png"]])
        self.assertEqual(len(self.stored_files()), 3)

    def test_duplicate_warning_and_stale_edit_leave_no_new_files(self):
        saved = self.save(batch("original"), recognitionImages=[image_input()])
        before = [p.name for p in self.stored_files()]
        with self.assertRaises(IntakeDuplicateConfirmationRequired) as caught:
            self.save(batch("other"), checkDuplicates=True, recognitionImages=[image_input("blue")])
        self.assertEqual([p.name for p in self.stored_files()], before)
        self.save(
            batch("other"),
            checkDuplicates=True,
            duplicateConfirmation=caught.exception.details["confirmationToken"],
            recognitionImages=[image_input("blue")],
        )
        saved = self.save(saved, editing=True, expectedUpdatedAt=saved["updatedAt"])
        before = len(self.stored_files())
        with self.assertRaises(StaleWriteError):
            self.save(saved, editing=True, expectedUpdatedAt="old-version", recognitionImages=[image_input("green")])
        self.assertEqual(len(self.stored_files()), before)

    def test_legacy_edit_preserves_originals_and_does_not_accept_forged_file_references(self):
        saved = self.save(batch(), recognitionImages=[image_input()])
        original = copy.deepcopy(saved["recognition"]["images"])
        old_client = {key: value for key, value in saved.items() if key != "recognition"}
        updated = self.save(old_client, editing=True, expectedUpdatedAt=saved["updatedAt"])
        self.assertEqual(updated["recognition"]["images"], original)
        self.assertEqual(updated["recognition"]["imageIds"], [image["id"] for image in original])
        updated["recognition"] = None
        updated = self.save(updated, editing=True, expectedUpdatedAt=updated["updatedAt"])
        self.assertEqual(updated["recognition"]["images"], original)
        updated["recognition"]["images"] = [{"id": "../forged", "dataUrl": image_input()["dataUrl"]}]
        again = self.save(
            updated, editing=True, expectedUpdatedAt=updated["updatedAt"], recognitionImages=[image_input()]
        )
        self.assertEqual(again["recognition"]["images"], original)
        self.assertEqual(len(self.stored_files()), 1)
        with self.connect() as conn, self.assertRaises(LookupError):
            recognition_images.read_image(conn, "another-batch", original[0]["id"])

    def test_audit_failure_rolls_back_database_and_removes_only_new_files(self):
        saved = self.save(batch("original"), recognitionImages=[image_input()])
        original_path = self.stored_files()[0]
        original_content = original_path.read_bytes()
        with patch.object(intake_commands, "write_audit_events", side_effect=OSError("audit unavailable")):
            with self.assertRaises(OSError):
                self.save(batch("failed"), recognitionImages=[image_input("blue")])
        self.assertEqual(self.stored_files(), [original_path])
        self.assertEqual(original_path.read_bytes(), original_content)
        with self.connect() as conn:
            self.assertIsNone(conn.execute("SELECT id FROM intake_batches WHERE id='failed'").fetchone())
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM intake_batches").fetchone()[0], 1)
        self.assertEqual(saved["recognition"]["images"][0]["name"], "预约.png")
