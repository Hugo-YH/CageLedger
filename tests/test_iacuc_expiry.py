import unittest

from server_app.repositories.iacuc import filter_iacuc_index, lookup_iacuc_principals


class IacucIndexFilterTests(unittest.TestCase):
    def test_empty_query_honors_limit(self):
        payload = {"items": [{"iacuc": f"Z{i:03d}"} for i in range(120)], "count": 120, "source": "test"}
        result = filter_iacuc_index(payload, "", limit=5)
        self.assertEqual(len(result["items"]), 5)
        self.assertEqual(result["count"], 120)

    def test_query_prefix_first_with_limit(self):
        payload = {"items": [{"iacuc": "Z2025001"}, {"iacuc": "ZZ1000"}, {"iacuc": "z2025999"}], "count": 3}
        result = filter_iacuc_index(payload, "Z2025", limit=2)
        self.assertEqual(len(result["items"]), 2)
        self.assertEqual(result["items"][0]["iacuc"], "Z2025001")
        self.assertEqual(result["items"][1]["iacuc"], "z2025999")

    def test_batch_lookup_is_exact_projected_and_retains_missing_and_duplicate_names(self):
        payload = {
            "updatedAt": "current",
            "items": [
                {"iacuc": "z1", "pi": "A", "rawFields": {"private": "not for statistics"}},
                {"iacuc": "Z1", "pi": "B"},
                {"iacuc": "Z10", "pi": "prefix"},
                {"iacuc": "Z2", "pi": ""},
            ],
        }
        result = lookup_iacuc_principals(payload, [" z1 ", "Z2", "missing", "Z1"])
        self.assertEqual(
            result,
            {
                "items": [{"iacuc": "z1", "pi": "A"}, {"iacuc": "Z1", "pi": "B"}, {"iacuc": "Z2", "pi": ""}],
                "counts": {"Z1": 2, "Z2": 1, "MISSING": 0},
                "updatedAt": "current",
            },
        )

    def test_batch_lookup_bounds_per_code_payload_without_hiding_ambiguity(self):
        result = lookup_iacuc_principals({"items": [{"iacuc": "Z1", "pi": "A"}] * 81}, ["Z1"])
        self.assertEqual(len(result["items"]), 80)
        self.assertEqual(result["counts"], {"Z1": 81})
        for codes in (None, "Z1", [], [""], [" "], [None], ["x" * 201], ["Z1"] * 201):
            with self.subTest(codes=codes), self.assertRaises(ValueError):
                lookup_iacuc_principals({}, codes)


if __name__ == "__main__":
    unittest.main()
