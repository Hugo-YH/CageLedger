import unittest
from unittest.mock import patch

from server_app.domains.intake.ai_parse import _normalize_payload, ai_parse_intake_images, ai_parse_intake_message
from server_app.domains.intake.identifier_recognition import (
    identifier_candidates,
    normalize_recognized_identifiers,
    recognized_identifiers,
)
from server_app.shared.intake_identifiers import normalize_intake_order_identifiers

PURCHASE = "C2026100925690"
ORDER = "DC202610092569007"


class IdentifierRecognitionTests(unittest.TestCase):
    def test_label_does_not_change_the_type_of_a_complete_source_number(self):
        for text in (
            "锐竞订单号：" + PURCHASE,
            "申请单号为" + PURCHASE,
            "锐竞采购申请号：" + PURCHASE,
            PURCHASE + "，",
            "采购单号：" + ORDER,
            "采购单号：ｃ２０２６１００９２５６９０",
        ):
            with self.subTest(text=text):
                expected = {"purchaseOrderNo": PURCHASE, "orderNo": ORDER if ORDER in text else ""}
                self.assertEqual(recognized_identifiers(text), expected)

    def test_boundaries_prevent_partial_numbers_and_split_fragments(self):
        for text in ("C20261009 25690", PURCHASE + "9", "X" + PURCHASE, ORDER + "9", "C57BL/6J", "13424051460"):
            with self.subTest(text=text):
                self.assertEqual(recognized_identifiers(text), {"purchaseOrderNo": "", "orderNo": ""})

    def test_repeated_values_are_deduplicated_and_multiple_values_remain_grouped(self):
        self.assertEqual(recognized_identifiers(PURCHASE + "\n" + PURCHASE.lower())["purchaseOrderNo"], PURCHASE)
        self.assertEqual(
            recognized_identifiers(PURCHASE + " C2026100925691")["purchaseOrderNo"], PURCHASE + "、C2026100925691"
        )
        self.assertEqual(recognized_identifiers(ORDER + " DC202610092569008")["orderNo"], ORDER + "、DC202610092569008")
        self.assertEqual(identifier_candidates(ORDER)["purchaseOrderNo"], [])

    def test_fresh_model_field_labels_are_corrected_without_changing_manual_normalization(self):
        for item in (
            {"orderNo": PURCHASE},
            {"purchaseOrderNo": ORDER},
            {"purchaseOrderNo": ORDER, "orderNo": PURCHASE},
        ):
            with self.subTest(item=item):
                result = normalize_recognized_identifiers({**item, "rawMessage": "原始依据"})
                self.assertEqual(result["purchaseOrderNo"], PURCHASE)
                self.assertEqual(result["orderNo"], ORDER if ORDER in item.values() else "")
                self.assertEqual(result["rawMessage"], "原始依据")
        # A complete C is a purchase identifier, including in a legacy field.
        self.assertEqual(normalize_intake_order_identifiers({"orderNo": PURCHASE})["purchaseOrderNo"], PURCHASE)
        self.assertEqual(
            normalize_intake_order_identifiers({"purchaseOrderNo": "不走锐竞"})["purchaseOrderNo"], "不走锐竞"
        )

    def test_model_conflicts_are_rejected(self):
        for item in ({"purchaseOrderNo": PURCHASE, "orderNo": "DC202610092569107"},):
            with self.subTest(item=item), self.assertRaises(ValueError):
                _normalize_payload(item)

    @patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_text_ai_uses_visible_source_numbers_even_if_model_labels_are_wrong(self, chat):
        chat.return_value = ({"orderNo": "C2026100925691", "quantity": 40}, {"totalTokens": 1})
        item, usage = ai_parse_intake_message("锐竞订单号：" + PURCHASE + "\n数量：40只")
        self.assertEqual((item["purchaseOrderNo"], item["orderNo"]), (PURCHASE, ""))
        self.assertEqual(item["quantity"], 40)
        self.assertEqual(usage, {"totalTokens": 1})

    @patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_text_ai_does_not_select_one_of_multiple_source_orders(self, chat):
        chat.return_value = ({"orderNo": ORDER}, {})
        item, _ = ai_parse_intake_message(ORDER + "、DC202610092569008")
        self.assertEqual(item["identifiers"]["orderNos"], [ORDER, "DC202610092569008"])
        self.assertEqual(item["identifiers"]["purchaseOrderNos"], [PURCHASE])

    @patch("server_app.domains.intake.ai_parse.deepseek_chat_json")
    def test_image_model_source_labels_are_classified_before_cross_image_checks(self, chat):
        from tests.test_intake_recognition_images import image_input, sample_result

        result = sample_result()
        source_purchase = result.pop("purchaseOrderNo")
        result["orderNo"] = source_purchase
        result["imageSources"] = [{"imageIndex": 1, "kind": "purchase", "orderNo": source_purchase}]
        chat.return_value = result, {}
        item, _, evidence = ai_parse_intake_images("", [], [image_input()])
        self.assertEqual((item["purchaseOrderNo"], item["orderNo"]), (source_purchase, ""))
        self.assertEqual(evidence["sources"][0]["purchaseOrderNo"], source_purchase)
        self.assertEqual(evidence["sources"][0]["orderNo"], "")


if __name__ == "__main__":
    unittest.main()
