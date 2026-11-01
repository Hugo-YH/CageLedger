"""Current notation for old AI drafts must not mutate archived evidence."""

import copy
import unittest

from server_app.domains.reception.certificate_review import current_result


class CertificateReviewTests(unittest.TestCase):
    def result(self):
        return {
            "lines": [
                {"certificateIndex": 1, "certificateLineIndex": 1, "sex": "雄性", "quantity": 21},
                {"certificateIndex": 1, "certificateLineIndex": 2, "sex": "雌性", "quantity": None},
            ],
            "warnings": [
                "雌性数量原文为“/”，未假定为0，已留空并标记。",
                "第1张合格证有待核对字段：雌性数量（原文为“/”，未给出）、证号",
                "第1张合格证存在未明确数量的明细，须补齐后才能确认保存",
                "雄性数量处有印章遮挡，按可见数字21提取",
            ],
        }

    def test_old_slash_draft_omits_zero_row_and_only_related_prompts_without_mutation(self):
        result = self.result()
        before = copy.deepcopy(result)
        adapted = current_result(result)
        self.assertEqual(adapted["lines"], [before["lines"][0]])
        self.assertEqual(
            adapted["warnings"],
            ["第1张合格证有待核对字段：证号", "雄性数量处有印章遮挡，按可见数字21提取"],
        )
        self.assertEqual(result, before)
        self.assertEqual(current_result(adapted), adapted)

    def test_actual_blanks_ambiguity_and_mixed_warnings_remain_for_review(self):
        for note in (
            "雌性数量空白，未给出",
            "雌性数量疑似为“/”，请核对",
            "雌性数量原文为“/”，但雄性数量模糊",
            "雌雄数量为13/8，请核对",
        ):
            result = self.result()
            result["warnings"] = [note]
            with self.subTest(note=note):
                self.assertEqual(current_result(result), result)
        result = self.result()
        result["lines"].append({**result["lines"][1], "certificateLineIndex": 3})
        self.assertEqual(current_result(result), result)

    def test_unscoped_multi_certificate_annotation_is_not_used_to_guess(self):
        result = self.result()
        result["warnings"] = result["warnings"][:1]
        result["lines"].append({**result["lines"][1], "certificateIndex": 2})
        self.assertEqual(current_result(result), result)
        result["warnings"] = ["第1张合格证有待核对字段：雌性数量（原文为“／”，未给出）"]
        adapted = current_result(result)
        self.assertEqual([line["certificateIndex"] for line in adapted["lines"]], [1, 2])
        self.assertIsNone(adapted["lines"][1]["quantity"])

    def test_another_unknown_and_its_warning_remain_and_positive_rows_are_never_changed(self):
        result = self.result()
        result["lines"].append({**result["lines"][0], "certificateLineIndex": 3, "quantity": None})
        adapted = current_result(result)
        self.assertEqual([line["quantity"] for line in adapted["lines"]], [21, None])
        self.assertIn(result["warnings"][2], adapted["warnings"])
        result["lines"][1]["quantity"] = 3
        result["lines"].pop()
        self.assertEqual(current_result(result), result)


if __name__ == "__main__":
    unittest.main()
