import unittest

from server_app.domains.intake.ai_parse import _normalize_payload
from server_app.domains.intake.husbandry_period import (
    calendar_month_end,
    normalize_husbandry_months,
    parse_husbandry_months,
)
from server_app.domains.intake.recognition_evidence import normalize_image_result, structure_image_sources


class IntakeCalendarPeriodTests(unittest.TestCase):
    def test_calendar_arithmetic(self):
        for start, months, expected in [
            ("2024-01-31", 1, "2024-02-29"),
            ("2025-01-31", 1, "2025-02-28"),
            ("2025-12-31", 2, "2026-02-28"),
            ("2024-02-29", 12, "2025-02-28"),
            ("9999-12-31", 1, ""),
        ]:
            with self.subTest(start=start):
                self.assertEqual(calendar_month_end(start, months), expected)
        for invalid in [0, -1, 1.5, True, "01"]:
            self.assertIsNone(normalize_husbandry_months(invalid))

    def test_requires_period_context_and_no_conflict(self):
        for raw, expected in [
            ("周期为1个月", 1),
            ("饲养一个月", 1),
            ("饲养周期2个月", 2),
            ("月龄2个月，体重20g", None),
            ("饲养1个月，周期2个月", None),
        ]:
            with self.subTest(raw=raw):
                self.assertEqual(parse_husbandry_months(raw), expected)

    def test_months_compute_only_with_intake_date(self):
        payload = {"intakeDate": "2024-01-31", "husbandryMonths": 1, "husbandryDays": 30}
        result = _normalize_payload(payload, month_evidence="周期为1个月")
        self.assertEqual((result["endDate"], result["husbandryDays"], result["husbandryMonths"]), ("2024-02-29", 29, 1))
        result = _normalize_payload({"husbandryMonths": 1, "husbandryDays": 30}, month_evidence="周期为1个月")
        self.assertEqual((result["endDate"], result["husbandryDays"], result["husbandryMonths"]), ("", None, 1))
        self.assertNotIn("husbandryMonths", _normalize_payload(payload, month_evidence="月龄1个月"))

    def test_explicit_dates_win_and_direct_sampling_clears(self):
        payload = {"intakeDate": "2024-01-31", "endDate": "2024-02-10", "husbandryMonths": 1}
        result = _normalize_payload(payload, month_evidence="周期为1个月")
        self.assertEqual(result["husbandryDays"], 10)
        self.assertIsNone(result["husbandryMonths"])
        result = _normalize_payload({**payload, "intakePurpose": "direct_sampling"}, month_evidence="周期为1个月")
        self.assertNotIn("husbandryMonths", result)
        self.assertIsNone(result["husbandryDays"])

    def test_source_conflict_and_application_date(self):
        sources = [
            {"kind": "husbandry", "reviewNotes": "周期为1个月"},
            {"kind": "husbandry", "reviewNotes": "饲养2个月"},
        ]
        merged = structure_image_sources({"husbandryMonths": 3, "imageSources": sources})
        self.assertNotIn("husbandryMonths", merged)
        self.assertTrue(any("不一致" in warning for warning in merged["recognition"]["warnings"]))
        for notes in (["饲养1个月，周期2个月"], ["周期为1个月", "饲养4周"]):
            merged = structure_image_sources(
                {
                    "husbandryDays": 30,
                    "imageSources": [{"kind": "husbandry", "reviewNotes": note, "husbandryDays": 30} for note in notes],
                }
            )
            self.assertNotIn("husbandryMonths", merged)
            self.assertIsNone(merged["husbandryDays"])
            self.assertTrue(any("冲突" in warning for warning in merged["recognition"]["warnings"]))
        merged = structure_image_sources(
            {"imageSources": sources[:1], "recognition": {"fieldSources": {"intakeDate": "采购申请日期：2024-01-31"}}}
        )
        item = _normalize_payload(
            {**merged, "intakeDate": "2024-01-31"},
            month_evidence=merged["recognition"]["fieldSources"]["husbandryMonths"],
        )
        item, _ = normalize_image_result(merged, item, "test")
        self.assertEqual(
            (item["intakeDate"], item["endDate"], item["husbandryDays"], item["husbandryMonths"]), ("", "", None, 1)
        )


if __name__ == "__main__":
    unittest.main()
