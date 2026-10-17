import json
import sqlite3
import unittest
from unittest.mock import Mock, patch

import server
from server_app.domains import dashboard_overview
from server_app.domains.billing.candidate_calculation import CandidateCalculation
from server_app.domains.billing.candidates import dashboard_candidate_snapshots
from server_app.domains.iacuc.sync import invalidate_quantity_sheet_candidate_snapshots_by_pi
from server_app.repositories.billing_candidates import (
    get_billing_candidate_snapshot,
    sync_billing_candidate_snapshot_registry,
    upsert_billing_candidate_snapshot,
)


class DashboardOverviewCacheTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        server.initialize_schema(self.conn)
        dashboard_overview.invalidate_dashboard_overview_cache()

    def tearDown(self):
        dashboard_overview.invalidate_dashboard_overview_cache()
        self.conn.close()

    def test_reuses_dashboard_payload_until_an_explicit_invalidation(self):
        with patch(
            "server_app.domains.dashboard_overview._intake_overview", wraps=dashboard_overview._intake_overview
        ) as intake:
            first = dashboard_overview.dashboard_overview_payload(self.conn, "2026-07", rooms=[])
            second = dashboard_overview.dashboard_overview_payload(self.conn, "2026-07", rooms=[])
            dashboard_overview.invalidate_dashboard_overview_cache()
            third = dashboard_overview.dashboard_overview_payload(self.conn, "2026-07", rooms=[])

        self.assertEqual(first, second)
        self.assertEqual(second, third)
        self.assertEqual(intake.call_count, 2)

    def test_dashboard_cache_uses_a_one_minute_ttl_for_a_month(self):
        with patch(
            "server_app.domains.dashboard_overview.cache_set", side_effect=lambda _key, value, **_kwargs: value
        ) as cache_set:
            dashboard_overview.dashboard_overview_payload(self.conn, "2026-07", rooms=[])

        self.assertEqual(cache_set.call_args.kwargs["ttl_seconds"], 60)
        self.assertEqual(dashboard_overview.DASHBOARD_CACHE_TTL_SECONDS, 60)

    def test_dashboard_history_cache_uses_a_five_minute_ttl(self):
        with patch(
            "server_app.domains.dashboard_overview.cache_set", side_effect=lambda _key, value, **_kwargs: value
        ) as cache_set:
            dashboard_overview.dashboard_overview_payload(self.conn, "all", rooms=[])

        self.assertEqual(cache_set.call_args.kwargs["ttl_seconds"], 300)
        self.assertEqual(dashboard_overview.DASHBOARD_HISTORY_CACHE_TTL_SECONDS, 300)

    def test_available_months_groups_intake_dates_in_sql(self):
        self.conn.execute(
            """
            INSERT INTO intake_batches
            (id, batch_no, status, intake_date, updated_at, payload)
            VALUES ('batch-1', 'B-1', 'received', '2026-07-01', '2026-07-01T00:00:00', '{}')
            """
        )
        self.conn.execute(
            """
            INSERT INTO intake_batches
            (id, batch_no, status, intake_date, updated_at, payload)
            VALUES ('batch-2', 'B-2', 'received', '2026-07-31', '2026-07-31T00:00:00', '{}')
            """
        )
        self.conn.commit()

        self.assertEqual(dashboard_overview._available_months(self.conn), ["2026-07"])

    def test_project_count_deduplicates_saved_ethics_across_sheets_and_rooms(self):
        for index, (month, iacuc, room) in enumerate(
            (
                ("2026-09", "Z1", "A"),
                ("2026-09", "Z1", "A"),
                ("2026-09", "Z1", "B"),
                ("2026-09", " Z2（备注） ", "B"),
                ("2026-09", "Z2", "A"),
                ("2026-09", "", "A"),
                ("2026-08", "Z1", "A"),
                ("2026-08", "Z3", "A"),
            )
        ):
            self.conn.execute(
                """INSERT INTO quantity_sheets (id, month, iacuc, room_id, updated_at, payload)
                   VALUES (?, ?, ?, ?, '2026-10-17', ?)""",
                (
                    f"project-sheet-{index}",
                    month,
                    iacuc,
                    room,
                    json.dumps(
                        {"id": f"project-sheet-{index}", "month": month, "iacuc": iacuc, "unitPrice": index + 1}
                    ),
                ),
            )

        self.assertEqual(dashboard_overview._quantity_sheet_iacuc_count(self.conn, "2026-09"), 2)
        self.assertEqual(dashboard_overview._quantity_sheet_iacuc_count(self.conn, "2026-08"), 2)
        self.assertEqual(dashboard_overview._quantity_sheet_iacuc_count(self.conn, "all"), 3)
        self.assertEqual(dashboard_overview._quantity_sheet_iacuc_count(self.conn, "2026-07"), 0)


class DashboardFeeOverviewTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        server.initialize_schema(self.conn)
        dashboard_overview.invalidate_dashboard_overview_cache()

    def tearDown(self):
        dashboard_overview.invalidate_dashboard_overview_cache()
        self.conn.close()

    def _seed_quantity_sheet(self, month, pi, iacuc):
        sheet_id = f"sheet-{month}-{pi}-{iacuc}"
        self.conn.execute(
            """
            INSERT INTO quantity_sheets (
                id, month, iacuc, room_id, room_name, manager, project, pi, owner, funding, updated_at, payload
            ) VALUES (?, ?, ?, '', '', '', '', ?, '', '', ?, ?)
            """,
            (
                sheet_id,
                month,
                iacuc,
                pi,
                f"{sheet_id}-updated",
                json.dumps({"id": sheet_id, "month": month, "pi": pi, "iacuc": iacuc}),
            ),
        )

    def _seed_snapshot(self, month, pi, iacuc, amount, *, stale=False, error=""):
        self._seed_quantity_sheet(month, pi, iacuc)
        sync_billing_candidate_snapshot_registry(self.conn, "quantity_sheet", "2026-10-17T00:00:00Z")
        current = get_billing_candidate_snapshot(self.conn, month, pi, "quantity_sheet")
        upsert_billing_candidate_snapshot(
            self.conn,
            {
                "month": month,
                "pi": pi,
                "sourceType": "quantity_sheet",
                "iacucs": [iacuc],
                "totalAmount": amount,
                "error": error,
                "stale": stale,
                "updatedAt": "2026-10-17T00:00:00Z",
                "sourceFingerprint": current["sourceFingerprint"],
            },
        )

    def test_pi_overview_keeps_real_zero_and_decimals_but_marks_unknown_amounts(self):
        self._seed_snapshot("2026-09", "零金额负责人", "Z0", 0)
        self._seed_snapshot("2026-09", "小数负责人", "Z1", 456.50)
        self._seed_snapshot("2026-08", "小数负责人", "Z2", 0.01)
        self._seed_snapshot("2026-09", "待核算负责人", "Z3", None, stale=True)

        by_pi = {item["pi"]: item for item in dashboard_overview._pi_overview(self.conn, "2026-09")}
        self.assertEqual(
            by_pi["零金额负责人"], {"pi": "零金额负责人", "amount": 0, "amountState": "ready", "iacucCount": 1}
        )
        self.assertEqual(
            by_pi["小数负责人"], {"pi": "小数负责人", "amount": 456.5, "amountState": "ready", "iacucCount": 1}
        )
        self.assertEqual(
            by_pi["待核算负责人"], {"pi": "待核算负责人", "amount": 0, "amountState": "pending", "iacucCount": 1}
        )

        all_by_pi = {item["pi"]: item for item in dashboard_overview._pi_overview(self.conn, "all")}
        self.assertEqual(all_by_pi["小数负责人"]["amount"], 456.51)
        self.assertEqual(all_by_pi["小数负责人"]["amountState"], "ready")
        self.assertEqual(all_by_pi["待核算负责人"]["amountState"], "pending")

    def test_dashboard_refreshes_stale_archived_and_locked_candidates_then_reuses_cached_amounts(self):
        self._seed_snapshot("2026-09", "已登记负责人", "Z1", None, stale=True)
        self._seed_snapshot("2026-09", "已归档负责人", "Z2", None, stale=True)
        for pi, status in (("已登记负责人", "statement_archived"), ("已归档负责人", "statement_locked")):
            self.conn.execute(
                """
                INSERT INTO billing_workflows (
                    id, business_key, iacuc, month, source_type, workflow_status, payload
                ) VALUES (?, ?, ?, '2026-09', 'pi_merged_quantity_sheet', ?, '{}')
                """,
                (f"workflow-{pi}", f"pi|{pi}", f"pi::{pi}", status),
            )
        calls = []

        def calculate(month, pi):
            calls.append((month, pi))
            return {"totalAmount": 12.34 if pi == "已登记负责人" else 56.78}

        rows = dashboard_candidate_snapshots(self.conn, "2026-09", calculate=calculate)
        self.assertEqual(set(calls), {("2026-09", "已登记负责人"), ("2026-09", "已归档负责人")})
        self.assertEqual({row["pi"] for row in rows}, {"已登记负责人", "已归档负责人"})
        self.assertTrue(all(row["total_amount"] is not None and not row["is_stale"] for row in rows))

        dashboard_candidate_snapshots(
            self.conn,
            "2026-09",
            calculate=lambda *_args: self.fail("已缓存候选不应重复计算"),
        )

    def test_dashboard_exposes_calculation_failure_without_fabricating_zero_as_ready(self):
        self._seed_snapshot("2026-09", "失败负责人", "Z1", None, stale=True)

        overview = dashboard_overview._pi_overview(
            self.conn,
            "2026-09",
            calculate=lambda *_args: (_ for _ in ()).throw(ValueError("计费条件不完整")),
        )

        self.assertEqual(
            overview,
            [
                {
                    "pi": "失败负责人",
                    "amount": 0,
                    "amountState": "error",
                    "amountError": "计费条件不完整",
                    "iacucCount": 1,
                }
            ],
        )
        snapshot = get_billing_candidate_snapshot(self.conn, "2026-09", "失败负责人", "quantity_sheet")
        self.assertFalse(snapshot["isStale"])
        self.assertIsNone(snapshot["totalAmount"])
        self.assertEqual(snapshot["error"], "计费条件不完整")

    def test_dashboard_candidate_calculation_prefers_issued_header_and_does_not_fallback_after_header_error(self):
        self._seed_snapshot("2026-09", "冻结负责人", "Z1", None, stale=True)
        live = Mock(return_value={"totalAmount": 999})
        calculation = CandidateCalculation(self.conn, live)
        key = ("2026-09", "冻结负责人")
        with patch(
            "server_app.domains.billing.candidate_calculation.frozen_statement_headers",
            return_value={key: {"totalAmount": 12.34}},
        ) as headers:
            overview = dashboard_overview._pi_overview(
                self.conn,
                "2026-09",
                calculate=calculation,
                prepare_calculations=calculation.prepare,
            )

        headers.assert_called_once_with(self.conn, [key], "pi_merged_quantity_sheet")
        live.assert_not_called()
        self.assertEqual(overview[0]["amount"], 12.34)
        self.assertEqual(overview[0]["amountState"], "ready")

        self._seed_snapshot("2026-10", "损坏快照负责人", "Z2", None, stale=True)
        error_live = Mock(return_value={"totalAmount": 999})
        error_calculation = CandidateCalculation(self.conn, error_live)
        error_key = ("2026-10", "损坏快照负责人")
        with patch(
            "server_app.domains.billing.candidate_calculation.frozen_statement_headers",
            return_value={error_key: ValueError("已发起流程的结算版本缺失")},
        ):
            error_overview = dashboard_overview._pi_overview(
                self.conn,
                "2026-10",
                calculate=error_calculation,
                prepare_calculations=error_calculation.prepare,
            )

        error_live.assert_not_called()
        self.assertEqual(error_overview[0]["amountState"], "error")
        self.assertEqual(error_overview[0]["amountError"], "已发起流程的结算版本缺失")

    def test_pi_identity_invalidation_evicts_old_dashboard_payload(self):
        self._seed_snapshot("2026-09", "缓存负责人", "Z1", 88.88)

        before = dashboard_overview.dashboard_overview_payload(self.conn, "2026-09", rooms=[])
        invalidate_quantity_sheet_candidate_snapshots_by_pi(self.conn, "缓存负责人")
        after = dashboard_overview.dashboard_overview_payload(self.conn, "2026-09", rooms=[])

        self.assertEqual(before["pi"][0]["amountState"], "ready")
        self.assertEqual(before["pi"][0]["amount"], 88.88)
        self.assertEqual(after["pi"][0]["amountState"], "pending")
        self.assertEqual(after["pi"][0]["amount"], 0)

    def test_stale_amount_is_pending_and_all_history_keeps_partial_amount_nonready(self):
        self._seed_snapshot("2026-09", "跨月负责人", "Z1", 12.34, stale=True)
        self._seed_snapshot("2026-08", "跨月负责人", "Z1", 0.01)
        self._seed_snapshot("2026-08", "跨月负责人", "Z2", 0)

        month = dashboard_overview._pi_overview(self.conn, "2026-09")
        self.assertEqual(month[0]["amountState"], "pending")
        self.assertEqual(month[0]["iacucCount"], 1)

        all_history = dashboard_overview._pi_overview(self.conn, "all")
        self.assertEqual(all_history[0]["amountState"], "pending")
        self.assertEqual(all_history[0]["iacucCount"], 2)

    def test_feeding_fee_total_preserves_decimal_and_zero_but_never_uses_partial_amounts(self):
        self.assertEqual(
            dashboard_overview._feeding_fee_total(
                [{"amount": 0.1}, {"amount": 0.2, "amountState": "ready"}, {"amount": 0}]
            ),
            {"amount": 0.3, "amountState": "ready"},
        )
        self.assertEqual(
            dashboard_overview._feeding_fee_total([]),
            {"amount": 0, "amountState": "ready"},
        )
        self.assertEqual(
            dashboard_overview._feeding_fee_total(
                [{"amount": 12.34, "amountState": "ready"}, {"amount": 0, "amountState": "pending"}]
            ),
            {"amount": None, "amountState": "pending"},
        )
        self.assertEqual(
            dashboard_overview._feeding_fee_total(
                [{"amount": 12.34, "amountState": "pending"}, {"amount": 0, "amountState": "error"}]
            ),
            {"amount": None, "amountState": "error"},
        )

    def test_all_payload_exposes_ready_feeding_fee_total(self):
        self._seed_snapshot("2026-09", "负责人甲", "Z1", 0.01)
        self._seed_snapshot("2026-08", "负责人乙", "Z2", 456.50)

        payload = dashboard_overview.dashboard_overview_payload(self.conn, "all", rooms=[])

        self.assertEqual(payload["feedingFeeTotal"], {"amount": 456.51, "amountState": "ready"})


if __name__ == "__main__":
    unittest.main()
