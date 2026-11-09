"""Image facts replace text defaults only after an explicit, uniquely matched review."""

import copy
from unittest import TestCase

from server_app.domains.intake.recognition_specification import specification_fits_request
from server_app.repositories.entities import upsert_intake_batch
from tests import test_intake_reconciliation as fixture
from tests.test_intake_recognition_images import image_input


class IncomingImageReconciliationTests(TestCase):
    setUp = fixture.IntakeReconciliationTests.setUp
    connect = fixture.IntakeReconciliationTests.connect
    save = fixture.IntakeReconciliationTests.save
    snapshot = fixture.IntakeReconciliationTests.snapshot
    original = fixture.IntakeReconciliationTests.original
    incoming_item = fixture.IntakeReconciliationTests.incoming_item
    preview = fixture.IntakeReconciliationTests.preview
    supplement = fixture.IntakeReconciliationTests.supplement

    def example(self, *, image=False):
        original = self.original(
            image=image,
            purchaseOrderNo="C2026110917024",
            batchNo="（Z2026032）2026110607",
            iacuc="Z2026032",
            strainRaw="C57",
            strainStandard="C57BL/6J",
            specification="",
            sex="雌性/雄性",
            quantity=12,
            finalCardCount=3,
            intakeDate="2026-11-11",
            endDate="2026-11-28",
            husbandryDays=17,
        )
        images = [image_input("blue", name="需求.png"), image_input("green", name="采购.png")]
        incoming = self.incoming_item(
            original,
            images,
            rawMessage="",
            sex="雌性",
            specification="6w",
            intakeDate="",
            endDate="",
            strainRaw="C57BL/6JGpt小鼠",
        )
        incoming["recognition"]["sources"] = [
            {
                "imageIndex": 1,
                "kind": "husbandry",
                "iacuc": original["iacuc"],
                "batchNo": original["batchNo"],
                "strainRaw": "C57",
                "specification": "6-8周",
                "quantity": 12,
                "maleQuantity": 0,
                "femaleQuantity": 12,
                "reviewNotes": "王骞 进8103 饲养周期：17天",
                "husbandryDays": 17,
            },
            {
                "imageIndex": 2,
                "kind": "purchase",
                "purchaseOrderNo": original["purchaseOrderNo"],
                "batchNo": original["batchNo"],
                "productName": "C57BL/6JGpt小鼠",
                "specification": "6周龄 雌",
                "quantity": 12,
            },
        ]
        return original, incoming, images

    def test_text_then_images_uses_image_sex_and_specification_retains_text_dates_and_card_identity(self):
        original, incoming, images = self.example()
        before = self.snapshot()
        result = self.preview(incoming, images)
        self.assertEqual(result["sourceIssues"], [])
        candidate = result["items"][0]
        self.assertEqual(candidate["mergeStrategy"], "incoming_image_first")
        self.assertTrue(candidate["canMerge"])
        self.assertFalse(candidate["canAcknowledge"])
        self.assertEqual(self.snapshot(), before)
        candidate["mergedItem"].update(quantity=999, cards=[])
        saved = self.supplement(candidate, incoming, images)
        self.assertEqual((saved["sex"], saved["specification"]), ("雌性", "6w"))
        for field in ("id", "cards", "quantity", "intakeDate", "endDate", "husbandryDays", "status"):
            self.assertEqual(saved[field], original[field], field)
        self.assertEqual(saved.get("receipts", []), original.get("receipts", []))
        self.assertEqual(len(saved["recognition"]["images"]), 2)
        round_ = saved["recognition"]["recognitionRounds"][0]
        self.assertIn("sex", round_["appliedFields"])
        self.assertEqual(round_["evidence"]["sources"], incoming["recognition"]["sources"])

    def test_true_source_conflicts_identity_conflicts_and_existing_images_still_block(self):
        original, incoming, images = self.example()
        for mutate in ("outside_spec", "different_quantity", "different_batch", "unknown_strain"):
            with self.subTest(mutate=mutate):
                item = copy.deepcopy(incoming)
                if mutate == "outside_spec":
                    item["recognition"]["sources"][1]["specification"] = "10周龄"
                elif mutate == "different_quantity":
                    item["recognition"]["sources"][1]["quantity"] = 13
                elif mutate == "different_batch":
                    item["batchNo"] = "（Z2026032）2026110608"
                else:
                    item["strainStandard"] = "不能确认的新品系XYZ"
                result = self.preview(item, images)
                self.assertTrue(all(not row["canMerge"] for row in result["items"]))
        for protection in (
            {"status": "received"},
            {"receipts": [{"id": "partial", "cardCount": 1}]},
            {"sex": "雄性", "recognition": {"images": [{"sha256": "saved"}]}},
        ):
            with self.subTest(protection=protection):
                with self.connect() as conn:
                    upsert_intake_batch(conn, {**original, **protection})
                self.assertFalse(self.preview(incoming, images)["items"][0]["canMerge"])

    def test_explicit_image_days_replace_the_text_month_intent_and_recalculate_end(self):
        original, incoming, images = self.example()
        original = self.save({**original, "husbandryMonths": 2}, exists=True, expectedUpdatedAt=original["updatedAt"])
        incoming["husbandryMonths"] = None
        candidate = self.preview(incoming, images)["items"][0]
        self.assertTrue(candidate["canMerge"])
        rows = {row["field"]: row for row in candidate["comparisons"]}
        self.assertEqual(rows["husbandryMonths"]["status"], "calculated")
        self.assertEqual(rows["endDate"]["calculation"]["periodSource"], "incoming")
        saved = self.supplement(candidate, incoming, images)
        self.assertEqual((saved["husbandryMonths"], saved["husbandryDays"], saved["endDate"]), (None, 17, "2026-11-28"))
        self.assertEqual(saved["cards"], original["cards"])

    def test_purchase_specification_must_fit_entire_request_with_the_same_dimensions(self):
        for request, purchase, expected in (
            ("6-8周", "6周龄 雌", True),
            ("6-8w", "6-7w", True),
            ("6-8w", "8w", True),
            ("6-8w", "7-9w", False),
            ("6-8w", "9w", False),
            ("6-8w", "1-2m", False),
            ("6-8w / 18-22g", "6w / 20g", True),
            ("6-8w / 18-22g", "6w", False),
            ("未知", "6w", False),
            ("-", "-", False),
        ):
            with self.subTest(request=request, purchase=purchase):
                self.assertEqual(specification_fits_request(request, purchase), expected)
