import unittest

from server_app.repositories.billing_candidate_batches import (
    quantity_settlement_groups_many,
    upsert_candidate_snapshots_many,
)
from server_app.repositories.billing_candidates import get_quantity_settlement_group, upsert_billing_candidate_snapshot
from tests.test_billing_candidates import build_candidate_conn, seed_quantity_sheet


class CandidateBatchTests(unittest.TestCase):
    def test_group_reads_preserve_single_reader_order_fingerprint_and_missing_keys(self):
        with build_candidate_conn() as conn:
            for identity, iacuc in (("a", "Z2"), ("A", "z2"), ("b", "Z1")):
                seed_quantity_sheet(conn, identity, "2026-09", "负责人", iacuc)
            keys = [("2026-09", "负责人"), ("2026-08", "不存在")]
            self.assertEqual(
                quantity_settlement_groups_many(conn, keys), {keys[0]: get_quantity_settlement_group(conn, *keys[0])}
            )
            self.assertEqual(quantity_settlement_groups_many(conn, []), {})

    def test_batch_writes_match_single_writes_including_relations_errors_and_duplicate_keys(self):
        with build_candidate_conn() as before, build_candidate_conn() as after:
            values = [
                {
                    "sourceType": "quantity_sheet",
                    "month": "2026-09",
                    "pi": f"负责人{i}",
                    "iacucs": ["Z2", " Z1 ", "Z2"],
                    "totalAmount": 0.01 * i,
                    "error": "核查" if i == 4 else "",
                    "stale": i % 2 == 0,
                    "updatedAt": "2026-10-18",
                    "sourceFingerprint": f"v{i}",
                }
                for i in range(123)
            ]
            for snapshot in values:
                upsert_billing_candidate_snapshot(before, snapshot)
            upsert_candidate_snapshots_many(after, values)
            changed = [
                {**values[0], "iacucs": [], "totalAmount": 0},
                {**values[0], "iacucs": ["NEW"], "totalAmount": None, "error": "更新失败"},
            ]
            for snapshot in changed:
                upsert_billing_candidate_snapshot(before, snapshot)
            upsert_candidate_snapshots_many(after, changed)
            upsert_candidate_snapshots_many(after, [])
            for table in ("billing_candidate_snapshots", "billing_candidate_snapshot_iacucs"):
                self.assertEqual(
                    [tuple(row) for row in before.execute(f"SELECT * FROM {table} ORDER BY 1,2,3,4")],
                    [tuple(row) for row in after.execute(f"SELECT * FROM {table} ORDER BY 1,2,3,4")],
                )

    def test_large_group_reads_are_bounded_and_use_the_quantity_index(self):
        with build_candidate_conn() as conn:
            conn.execute("CREATE INDEX idx_test_qty_pi_month ON quantity_sheets(pi,month)")
            seed_quantity_sheet(conn, "a", "2026-09", "负责人", "Z1")
            queries = []
            conn.set_trace_callback(queries.append)
            keys = [("2026-09", "负责人"), *[("2026-09", f"missing-{i}") for i in range(450)]]
            self.assertEqual(len(quantity_settlement_groups_many(conn, keys)), 1)
            conn.set_trace_callback(None)
            self.assertEqual(len(queries), 3)
            plan = [row[3] for row in conn.execute("EXPLAIN QUERY PLAN " + queries[0])]
            self.assertTrue(any("SEARCH q USING INDEX idx_test_qty_pi_month" in item for item in plan), plan)
