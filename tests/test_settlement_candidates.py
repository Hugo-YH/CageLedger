import unittest

from server_app.domains.billing.candidates import list_settlement_candidates


class SettlementCandidateTests(unittest.TestCase):
    def setUp(self):
        self.groups = [
            {"month": "2026-06", "pi": "张教授"},
            {"month": "2026-07", "pi": "张教授"},
            {"month": "2026-06", "pi": "李教授"},
        ]
        self.statements = {
            ("2026-06", "张教授"): {"iacucs": ["Z1", "Z2"], "totalAmount": 200},
            ("2026-07", "张教授"): {"iacucs": ["Z3"], "totalAmount": 80},
            ("2026-06", "李教授"): {"iacucs": ["Z4"], "totalAmount": 120},
        }

    def calculate(self, month, pi):
        return self.statements[(month, pi)]

    def test_filters_full_candidate_set_before_pagination(self):
        result = list_settlement_candidates(
            self.groups,
            {
                "limit": 1,
                "offset": 0,
                "sortKey": "amount",
                "sortDir": "desc",
                "columnFilters": {"iacuc": ["Z2"]},
            },
            self.calculate,
        )
        self.assertEqual(result["page"]["total"], 1)
        self.assertEqual(result["items"][0]["pi"], "张教授")
        self.assertEqual(result["items"][0]["iacucs"], ["Z1", "Z2"])

    def test_sorts_amount_and_builds_column_options(self):
        result = list_settlement_candidates(
            self.groups,
            {"limit": 10, "offset": 0, "sortKey": "amount", "sortDir": "desc", "columnFilters": {}},
            self.calculate,
        )
        self.assertEqual([item["totalAmount"] for item in result["items"]], [200, 120, 80])
        self.assertEqual([item["value"] for item in result["filterOptions"]["iacuc"]], ["Z1", "Z2", "Z3", "Z4"])


if __name__ == "__main__":
    unittest.main()
