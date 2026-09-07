import unittest

from server_app.repositories.entities import intake_batch_order_by, intake_batch_where
from server_app.repositories.filter_options import filtered_where
from server_app.web.entity_contracts import ENTITY_ORDER_BY


class IntakeBatchFilterTests(unittest.TestCase):
    def test_default_order_prioritizes_the_latest_intake_date(self):
        self.assertEqual(
            intake_batch_order_by({}, ENTITY_ORDER_BY),
            "intake_date DESC, updated_at DESC, rowid DESC",
        )

    def test_month_filter_uses_an_indexable_date_range(self):
        where, params = intake_batch_where({"month": "2026-07"}, filtered_where)

        self.assertEqual(where, "intake_date >= ? AND intake_date < ?")
        self.assertEqual(params, ("2026-07-01", "2026-08-01"))

    def test_invalid_month_does_not_add_a_date_filter(self):
        where, params = intake_batch_where({"month": "all"}, filtered_where)

        self.assertEqual(where, "")
        self.assertEqual(params, ())


if __name__ == "__main__":
    unittest.main()
