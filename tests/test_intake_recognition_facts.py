"""Purchase facts remain separate from current-delivery arithmetic and canonical specs."""

import copy
import unittest
from unittest.mock import patch

from server_app.domains.intake.ai_parse import ai_parse_intake_images
from server_app.domains.intake.recognition_evidence import sanitize_evidence, structure_image_sources
from server_app.domains.intake.recognition_quantity import calculate_purchase_quantity
from server_app.domains.intake.recognition_specification import normalize_specification
from tests.test_intake_recognition_images import image_input


def purchase():
    return {
        "kind": "purchase",
        "quantity": 27,
        "specification": "SPF级/6-8周龄/下单27只，额外赠送3只",
        "quantityFacts": {
            "lineQuantity": 27,
            "lineQuantityEvidence": "数量：27",
            "giftQuantity": 3,
            "giftEvidence": "下单27只，额外赠送3只",
            "giftInclusion": "extra",
            "giftScope": "current_item",
            "currentDeliveryQuantity": 30,
            "currentDeliveryEvidence": "本次只进购30只",
            "deferredQuantity": 47,
            "deferredEvidence": "再进购剩余47只",
            "purchaseNotes": "审批77只，本次30只，后续47只",
        },
    }


class SpecificationTests(unittest.TestCase):
    def test_normalizes_only_age_and_weight_not_grade_order_or_husbandry_duration(self):
        for raw, expected in (
            ("SPF级/6-8周龄/下单27只，额外赠送3只", "6-8w"),
            ("1至2个月龄", "1-2m"),
            ("1～2年", "1-2y"),
            ("18－22克", "18-22g"),
            ("规格：18g-22g", "18-22g"),
            ("6-8 w / 18-22 g", "6-8w / 18-22g"),
            ("6-8weeks", "6-8w"),
            ("0.5-1千克", "0.5-1kg"),
            ("6.0 - 8.00周", "6-8w"),
            ("14-21日龄", "14-21d"),
            ("6-8周；饲养周期一个月", "6-8w"),
        ):
            with self.subTest(raw=raw):
                self.assertEqual(normalize_specification(raw), (expected, False))

    def test_missing_specification_is_not_a_conflict_and_ambiguous_specs_need_review(self):
        for raw in ("-", "—", "", None, "N/A"):
            self.assertEqual(normalize_specification(raw), ("", False))
        for raw in (
            "SPF级/下单27只，赠送3只",
            "饲养周期1个月",
            "8-6周",
            "0g",
            "6-8周/2-3月",
            "预计到货30天",
            "交货期限7天",
            "取材后14天",
            "7天后到货",
        ):
            self.assertEqual(normalize_specification(raw), ("", True))
        result = structure_image_sources({"imageSources": [{"kind": "husbandry", "specification": "-"}, purchase()]})
        self.assertEqual(result["specification"], "6-8w")
        self.assertFalse(any("规格）差异" in warning for warning in result["recognition"]["warnings"]))


class QuantityFactsTests(unittest.TestCase):
    def calculate(self, source):
        result = structure_image_sources({"imageSources": [source]})
        return result["quantity"], result["recognition"]["quantityCalculation"]

    def test_line_quantity_plus_explicit_extra_gift_does_not_add_current_or_future_notes(self):
        quantity, calculation = self.calculate(purchase())
        self.assertEqual(quantity, 30)
        self.assertEqual(calculation["formula"], "27 + 3 = 30")
        self.assertEqual(calculation["addedGiftQuantity"], 3)

    def test_included_gift_is_not_counted_twice(self):
        source = purchase()
        source["quantity"] = 30
        source["quantityFacts"].update(
            lineQuantity=30,
            lineQuantityEvidence="数量：30",
            giftInclusion="included",
            giftEvidence="数量30只，含赠送3只",
        )
        quantity, calculation = self.calculate(source)
        self.assertEqual((quantity, calculation["addedGiftQuantity"]), (30, 0))

    def test_future_gift_does_not_enter_current_delivery(self):
        source = purchase()
        source["quantityFacts"].update(
            giftScope="other",
            giftEvidence="下批额外赠送3只",
            currentDeliveryQuantity=27,
            currentDeliveryEvidence="本次27只",
        )
        self.assertEqual(self.calculate(source)[0], 27)

    def test_no_gift_does_not_require_fabricated_zero(self):
        source = purchase()
        source["specification"] = "SPF级/6-8周龄"
        source["quantityFacts"].update(
            giftQuantity=None,
            giftEvidence="",
            giftInclusion="none",
            giftScope="unknown",
            currentDeliveryQuantity=27,
            currentDeliveryEvidence="本次27只",
        )
        self.assertEqual(self.calculate(source)[0], 27)

    def test_uncertain_or_contradictory_facts_leave_quantity_empty(self):
        updates = (
            {"giftInclusion": "unknown"},
            {"giftScope": "unknown"},
            {"giftEvidence": "赠送3只"},
            {"giftEvidence": "额外赠送5只"},
            {"giftEvidence": "已含额外赠送3只"},
            {"giftEvidence": "下次额外赠送3只"},
            {"giftEvidence": "不额外赠送3只"},
            {"giftEvidence": "额外赠送3只，暂不确定"},
            {"giftQuantity": 27},
            {"giftEvidence": "额外赠送3只，另赠送4只"},
            {"lineQuantityEvidence": "商品数量不清楚"},
            {"lineQuantityEvidence": "数量不是27只"},
            {"lineQuantityEvidence": "订单号27，数量待确认"},
            {"lineQuantityEvidence": "订单号27，数量30"},
            {"giftQuantity": None},
            {"currentDeliveryQuantity": 33, "currentDeliveryEvidence": "本次33只"},
            {"currentDeliveryEvidence": "本次不清楚"},
            {"currentDeliveryQuantity": 47, "currentDeliveryEvidence": "本次30只，后续47只"},
        )
        for update in updates:
            source = purchase()
            source["quantityFacts"].update(update)
            with self.subTest(update=update):
                quantity, calculation = self.calculate(source)
                self.assertIsNone(quantity)
                self.assertEqual(calculation["status"], "review_required")
        source = purchase()
        source["quantity"] = 30  # Model prematurely added the gift into the table field.
        self.assertIsNone(self.calculate(source)[0])
        for quote in ("数量30只，不含赠送3只", "数量30只，未包含赠送3只", "数量30只，不包括赠送3只"):
            source = purchase()
            source["quantity"] = 30
            source["quantityFacts"].update(
                lineQuantity=30, lineQuantityEvidence="数量30只", giftInclusion="included", giftEvidence=quote
            )
            self.assertIsNone(self.calculate(source)[0])

    def test_same_purchase_repeated_in_two_screenshots_does_not_sum_gifts(self):
        result = structure_image_sources({"imageSources": [purchase(), copy.deepcopy(purchase())]})
        self.assertEqual(result["quantity"], 30)
        source = purchase()
        source["quantityFacts"]["giftQuantity"] = 4
        source["quantityFacts"]["giftEvidence"] = "额外赠送4只"
        source["quantityFacts"]["currentDeliveryQuantity"] = 31
        source["quantityFacts"]["currentDeliveryEvidence"] = "本次31只"
        result = structure_image_sources({"imageSources": [purchase(), source]})
        self.assertIsNone(result["quantity"])

    def test_legacy_purchase_shape_remains_supported(self):
        self.assertEqual(calculate_purchase_quantity({"quantity": 24})["actualQuantity"], 24)
        self.assertIsNone(
            calculate_purchase_quantity({"quantity": 27, "specification": "额外赠送3只"})["actualQuantity"]
        )

    def test_impossible_included_count_and_raw_specification_conflicts_require_review(self):
        source = purchase()
        source["quantity"] = 2
        source["quantityFacts"].update(
            lineQuantity=2,
            lineQuantityEvidence="数量2",
            giftInclusion="included",
            giftEvidence="含赠送3只",
            currentDeliveryQuantity=None,
        )
        self.assertIsNone(self.calculate(source)[0])
        for spec in ("SPF/6-8周，额外赠送4只", "SPF/6-8周，包含赠送3只"):
            source = purchase()
            source["specification"] = spec
            self.assertIsNone(self.calculate(source)[0])

    def test_source_and_calculation_survive_sanitization_without_changing_reviewed_main_quantity(self):
        result = structure_image_sources({"imageSources": [purchase()]})
        evidence = sanitize_evidence(result["recognition"])
        self.assertEqual(evidence["sources"][0]["quantity"], 27)
        self.assertEqual(evidence["sources"][0]["quantityFacts"]["deferredQuantity"], 47)
        self.assertEqual(evidence["quantityCalculation"]["actualQuantity"], 30)

    @patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_full_image_chain_uses_30_preserves_15_cages_and_does_not_compare_77_sex_to_30(self, chat):
        chat.return_value = (
            {
                "quantity": 999,
                "maleQuantity": 0,
                "femaleQuantity": 77,
                "imageSources": [
                    {
                        "kind": "husbandry",
                        "quantity": 77,
                        "maleQuantity": 0,
                        "femaleQuantity": 77,
                        "specification": "-",
                        "roomName": "8101",
                        "finalCardCount": 15,
                        "reviewNotes": "8101，共15笼，饲养周期一个月",
                    },
                    purchase(),
                ],
            },
            {},
        )
        item, _, evidence = ai_parse_intake_images("", [], [image_input(), image_input("blue")])
        self.assertEqual(
            (item["quantity"], item["specification"], item["finalCardCount"], item["roomName"]),
            (30, "6-8w", 15, "8101"),
        )
        self.assertEqual(item["sex"], "雌性")
        self.assertIsNone(item["husbandryDays"])
        self.assertEqual(item["intakeDate"], "")
        self.assertFalse(any("数量之和不一致" in text for text in evidence["warnings"]))
        prompt = chat.call_args.args[0]
        self.assertIn("供应商和单价后面的数量列", prompt)
        self.assertIn("不自行做赠送加法", prompt)


if __name__ == "__main__":
    unittest.main()
