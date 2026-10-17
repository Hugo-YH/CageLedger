"""Batch reads must agree with the original single-snapshot reader."""

import json
import unittest

from server_app.composition import generate_billing_statement_by_pi
from server_app.domains.billing.candidate_calculation import CandidateCalculation
from server_app.domains.billing.frozen import frozen_statement, frozen_statements
from server_app.domains.billing.snapshot_codec import SnapshotStorageError
from server_app.repositories.billing_snapshot_storage import expand_version, read_lines_many
from tests import test_billing_snapshot_storage as snapshot_fixture
from tests import test_reimbursement_ledger as ledger_fixture


class FrozenBatchTests(unittest.TestCase):
    def setUp(self):
        self.fixture = snapshot_fixture.BillingSnapshotStorageTests()
        self.fixture.setUp()
        self.conn = self.fixture.conn
        self.fixture.store()
        self.conn.execute("UPDATE billing_workflows SET workflow_status='statement_sent'")
        self.key = ("2026-10", "测试负责人")

    def tearDown(self):
        self.fixture.tearDown()

    def test_complete_and_legacy_details_match_the_single_reader(self):
        for legacy in (False, True):
            with self.subTest(legacy=legacy):
                if legacy:
                    expand_version(self.conn, self.fixture.version_id)
                expected = frozen_statement(self.conn, *self.key, "quantity_sheet")
                result = frozen_statements(self.conn, [self.key, self.key, ("2026-09", "未知")], "quantity_sheet")
                self.assertEqual(result, {self.key: expected})
                self.assertEqual(read_lines_many(self.conn, ["missing"]), {"missing": []})

    def test_corruption_is_reported_without_losing_other_scopes(self):
        other = self.add_workflow("other", "另一个负责人", "Z2026002", 40)
        for column, value in (("payload", b"broken"), ("raw_sha256", "0" * 64), ("codec", "unknown")):
            original = self.conn.execute(f"SELECT {column} FROM billing_statement_line_blocks").fetchone()[0]
            self.conn.execute(f"UPDATE billing_statement_line_blocks SET {column}=?", (value,))
            with self.subTest(column=column), self.assertRaises(SnapshotStorageError):
                frozen_statement(self.conn, *self.key, "quantity_sheet")
            result = frozen_statements(self.conn, [self.key, other], "quantity_sheet")
            self.assertIsInstance(result[self.key], SnapshotStorageError)
            self.assertEqual(result[other], frozen_statement(self.conn, *other, "quantity_sheet"))
            self.conn.execute(f"UPDATE billing_statement_line_blocks SET {column}=?", (original,))
        self.conn.execute("UPDATE billing_statement_version_lines SET payload=json_set(payload,'$.amount',99)")
        self.assertIsInstance(
            frozen_statements(self.conn, [self.key], "quantity_sheet")[self.key], SnapshotStorageError
        )
        self.conn.execute("DELETE FROM billing_statement_line_blocks")
        self.assertIsInstance(
            frozen_statements(self.conn, [self.key], "quantity_sheet")[self.key], SnapshotStorageError
        )

    def test_latest_workflow_ties_and_fee_family_match_single_scope(self):
        for identity, iacuc in (("z-workflow", "Z2026002"), ("a-workflow", "Z2026003")):
            self.add_workflow(identity, self.key[1], iacuc, 40 if identity.startswith("a") else 80)
        self.conn.execute("UPDATE billing_workflows SET latest_event_at='2026-10-31'")
        expected = frozen_statement(self.conn, *self.key, "quantity_sheet")
        self.assertEqual(expected[0]["totalAmount"], 40)
        self.assertEqual(frozen_statements(self.conn, [self.key], "quantity_sheet")[self.key], expected)
        self.assertEqual(frozen_statements(self.conn, [self.key], "pi_merged_technical_service"), {})
        self.assertEqual(frozen_statements(self.conn, [], "quantity_sheet"), {})

    def test_wrong_workflow_version_and_missing_statement_keep_errors(self):
        other = self.add_workflow("other", "另一个负责人", "Z2026002", 40)
        self.conn.execute(
            "UPDATE billing_workflows SET current_version_id='other-version' WHERE id=?", (self.fixture.workflow_id,)
        )
        result = frozen_statements(self.conn, [self.key, other], "quantity_sheet")
        self.assertEqual(str(result[self.key]), "已发起流程的结算版本缺失，请核查历史记录")
        self.assertEqual(result[other][0]["totalAmount"], 40)
        self.conn.execute(
            "UPDATE billing_workflows SET current_version_id=? WHERE id=?",
            (self.fixture.version_id, self.fixture.workflow_id),
        )
        self.conn.execute("UPDATE billing_statement_versions SET payload='{}' WHERE id=?", (self.fixture.version_id,))
        self.assertEqual(
            str(frozen_statements(self.conn, [self.key], "quantity_sheet")[self.key]),
            "已发起流程的结算内容缺失，请核查历史记录",
        )

    def test_large_batch_uses_bounded_queries_and_retains_date_order(self):
        identities = [self.fixture.version_id, *[f"missing-{i}" for i in range(220)]]
        statements = []
        self.conn.set_trace_callback(statements.append)
        try:
            result = read_lines_many(self.conn, identities)
        finally:
            self.conn.set_trace_callback(None)
        self.assertEqual(len(statements), 5)
        self.assertEqual(len(result), len(identities))
        self.assertEqual(
            [line["id"] for line in result[self.fixture.version_id]],
            ["line-1", "line-2", "line-3", "line-4", "line-5", "line-0"],
        )

    def test_candidate_uses_complete_snapshot_and_never_live_fallback_on_corruption(self):
        self.conn.execute("UPDATE billing_workflows SET source_type='pi_merged_quantity_sheet'")
        calls = []

        def live(month, pi):
            calls.append((month, pi))
            return {"totalAmount": 999}

        calculation = CandidateCalculation(self.conn, live)
        calculation.prepare([self.key, ("2026-09", "未知")])
        self.assertEqual(calculation(*self.key)["totalAmount"], 300)
        self.assertEqual(calls, [])
        self.assertEqual(calculation("2026-09", "未知"), {"totalAmount": 999})
        self.assertEqual(calls, [("2026-09", "未知")])
        self.conn.execute("UPDATE billing_statement_line_blocks SET raw_sha256='broken'")
        calculation = CandidateCalculation(self.conn, live)
        calculation.prepare([self.key])
        with self.assertRaises(SnapshotStorageError):
            calculation(*self.key)
        self.assertEqual(calls, [("2026-09", "未知")])

    def test_candidate_preserves_generator_validation_and_normalization_for_legacy_keys(self):
        for month, pi, message in (
            ("2026-1", self.key[1], "结算月份格式应为 YYYY-MM"),
            ("2026-10", "测试  负责人", "未找到该 PI 在结算月份内的数量统计表"),
        ):
            with self.subTest(month=month, pi=pi):
                self.conn.execute(
                    "UPDATE billing_workflows SET source_type='pi_merged_quantity_sheet',month=?,payload=json_set(payload,'$.pi',?)",
                    (month, pi),
                )
                calculation = CandidateCalculation(
                    self.conn,
                    lambda month, pi: generate_billing_statement_by_pi(
                        self.conn,
                        {"month": month, "pi": pi, "sourceType": "quantity_sheet"},
                        ledger_fixture.ADMIN,
                    )[0],
                )
                calculation.prepare([(month, pi)])
                with self.assertRaisesRegex(ValueError, message):
                    calculation(month, pi)

    def add_workflow(self, identity, pi, iacuc, amount):
        ledger_fixture.ReimbursementLedgerTests._insert_statement_on(
            self.conn, identity, identity + "-version", "2026-10", pi, iacuc, amount
        )
        payload = json.dumps({"pi": pi})
        self.conn.execute(
            "UPDATE billing_workflows SET workflow_status='statement_sent',payload=? WHERE id=?", (payload, identity)
        )
        return ("2026-10", pi)
