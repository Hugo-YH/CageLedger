import unittest

from server_app.domains.billing.allowance import iacuc_free_allowance_eligible
from server_app.domains.billing.statements import quantity_sheet_statement_lines
from server_app.domains.iacuc import normalize_application_date


class IacucDateNormalizationTests(unittest.TestCase):
    def test_normalizes_spaces_around_date_separators(self):
        self.assertEqual(normalize_application_date("2026- 6- 30"), "2026-06-30")

    def test_uses_normalized_end_date_for_free_cage_eligibility(self):
        application = {"projectEndDate": "2026- 6- 30"}
        self.assertTrue(iacuc_free_allowance_eligible(application, "2026-06-30"))
        self.assertFalse(iacuc_free_allowance_eligible(application, "2026-07-01"))

    def test_monthly_allowance_preserves_date_boundaries_and_application_fallback(self):
        sheet = {
            "id": "dated-sheet",
            "month": "2026-11",
            "iacuc": "Z1",
            "initialCageCount": 5,
            "rows": [],
            "projectStartDate": "2026年11月10日",
            "projectEndDate": "2026- 11- 15",
        }
        for applications, free_days in (
            ({}, set(range(10, 16))),
            ({"Z1": {"projectStartDate": "2026/11/12", "projectEndDate": "2026.11.13"}}, {12, 13}),
            ({"Z1": {"iacuc": "Z1"}}, set(range(1, 31))),
        ):
            with self.subTest(applications=applications):
                lines = quantity_sheet_statement_lines([sheet], 20, [], applications)
                self.assertEqual(
                    [line["amount"] for line in lines],
                    [0 if day in free_days else 22.5 for day in range(1, 31)],
                )


if __name__ == "__main__":
    unittest.main()
