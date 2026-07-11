import unittest

from server_app.domains.billing.allowance import iacuc_free_allowance_eligible
from server_app.domains.iacuc import normalize_application_date


class IacucDateNormalizationTests(unittest.TestCase):
    def test_normalizes_spaces_around_date_separators(self):
        self.assertEqual(normalize_application_date("2026- 6- 30"), "2026-06-30")

    def test_uses_normalized_end_date_for_free_cage_eligibility(self):
        application = {"projectEndDate": "2026- 6- 30"}
        self.assertTrue(iacuc_free_allowance_eligible(application, "2026-06-30"))
        self.assertFalse(iacuc_free_allowance_eligible(application, "2026-07-01"))


if __name__ == "__main__":
    unittest.main()
