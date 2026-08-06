import unittest

from server_app.repositories.iacuc import filter_iacuc_index


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


if __name__ == "__main__":
    unittest.main()
