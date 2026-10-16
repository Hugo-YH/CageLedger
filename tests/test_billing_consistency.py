import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from scripts.check_billing_consistency import fingerprint, review_database
from server_app.domains.reimbursement_ledger.consistency import check_consistency
from server_app.domains.reimbursement_ledger.repository import upsert_obligation
from server_app.domains.reimbursement_ledger.service import (
    confirm_allocation,
    create_allocation,
    reverse_allocation,
    save_claim,
)
from server_app.repositories.billing_statements import replace_billing_statement_version_lines
from server_app.repositories.billing_workflows import delete_billing_workflow_tree
from tests import test_reimbursement_ledger as fixture


class BillingConsistencyTests(unittest.TestCase):
    def setUp(self):
        self.base = fixture.ReimbursementLedgerTests()
        self.base.setUp()
        self.conn = self.base.conn
        self.obligation = self.conn.execute(
            "SELECT id FROM reimbursement_settlement_obligations WHERE workflow_id='workflow-a'"
        ).fetchone()[0]

    def tearDown(self):
        self.base.tearDown()

    def claim(self, amount=0.3):
        return save_claim(
            self.conn,
            fixture.ADMIN,
            None,
            {
                "documentNumber": "CONSISTENCY-TEST",
                "fundingLines": [
                    {"fundBookNo": "F1", "fundingOwner": "测试", "reimbursementAmount": amount},
                ],
            },
        )["item"]

    def allocation(self, claim, amount):
        return create_allocation(
            self.conn,
            fixture.ADMIN,
            {
                "claimId": claim["id"],
                "fundingLineId": claim["fundingLines"][0]["id"],
                "obligationId": self.obligation,
                "amount": amount,
            },
        )["item"]

    def codes(self):
        return check_consistency(self.conn)["summary"]["byCode"]

    def test_clean_real_service_balances_and_reversed_drafts_are_read_only(self):
        self.conn.execute(
            "UPDATE reimbursement_settlement_obligations SET payable_amount=0.3,outstanding_amount=0.3 WHERE id=?",
            (self.obligation,),
        )
        self.conn.execute(
            "UPDATE billing_statement_versions SET payload=json_set(payload,'$.statement.totalAmount',0.3) WHERE id='version-a'"
        )
        claim = self.claim()
        first, second = self.allocation(claim, 0.1), self.allocation(claim, 0.2)
        confirm_allocation(self.conn, fixture.ADMIN, first["id"])
        confirm_allocation(self.conn, fixture.ADMIN, second["id"])
        reverse_allocation(self.conn, fixture.ADMIN, second["id"], "回归")
        self.allocation(claim, 0.01)  # Draft never contributes to balances.
        before, changes = list(self.conn.iterdump()), self.conn.total_changes
        report = check_consistency(self.conn)
        self.assertEqual(report["issues"], [])
        self.assertEqual(report["status"], "ok")
        self.assertEqual(list(self.conn.iterdump()), before)
        self.assertEqual(self.conn.total_changes, changes)

    def test_void_retains_reversed_history_without_source_or_outstanding(self):
        claim = self.claim(10)
        allocation = self.allocation(claim, 10)
        confirm_allocation(self.conn, fixture.ADMIN, allocation["id"])
        reverse_allocation(self.conn, fixture.ADMIN, allocation["id"], "撤销")
        self.conn.execute(
            "UPDATE reimbursement_settlement_obligations SET status='void',outstanding_amount=0 WHERE id=?",
            (self.obligation,),
        )
        delete_billing_workflow_tree(self.conn, "workflow-a")
        self.assertEqual(check_consistency(self.conn)["issues"], [])
        self.conn.execute("UPDATE reimbursement_allocations SET status='confirmed' WHERE id=?", (allocation["id"],))
        self.assertIn("void_confirmed_allocation", self.codes())

    def test_orphan_warning_escalates_when_confirmed_money_remains(self):
        claim = self.claim(10)
        allocation = self.allocation(claim, 10)
        delete_billing_workflow_tree(self.conn, "workflow-a")
        report = check_consistency(self.conn)
        self.assertEqual(report["status"], "warning")
        self.assertEqual(report["summary"]["byCode"], {"orphan_obligation": 1})
        self.conn.execute("UPDATE reimbursement_allocations SET status='confirmed' WHERE id=?", (allocation["id"],))
        report = check_consistency(self.conn)
        issue = next(item for item in report["issues"] if item["code"] == "orphan_obligation")
        self.assertEqual(issue["severity"], "error")
        self.assertEqual(issue["confirmedAllocationCount"], 1)

    def test_historical_version_and_negative_adjustment_are_valid(self):
        self.conn.execute(
            "INSERT INTO billing_statement_versions SELECT 'version-a2',workflow_id,2,version_status,workflow_status,generated_at,voided_at,created_by,payload FROM billing_statement_versions WHERE id='version-a'"
        )
        self.conn.execute(
            "UPDATE billing_workflows SET current_version_id='version-a2',current_version_no=2 WHERE id='workflow-a'"
        )
        upsert_obligation(
            self.conn,
            {
                "id": "negative-adjustment",
                "workflowId": "workflow-a",
                "statementVersionId": "version-a2",
                "statementVersionNo": 2,
                "month": "2026-06",
                "sourcePi": "测试",
                "iacuc": "Z2026001",
                "payableAmount": -10,
                "outstandingAmount": -10,
                "obligationKind": "adjustment",
                "status": "open",
                "createdAt": "2026-06-30",
                "updatedAt": "2026-06-30",
            },
        )
        self.assertEqual(check_consistency(self.conn)["issues"], [])
        self.conn.execute("UPDATE billing_workflows SET current_version_no=3 WHERE id='workflow-a'")
        self.assertIn("workflow_version_mismatch", self.codes())

    def test_balances_count_and_cent_mirror_drift_are_detected(self):
        claim = self.claim(10)
        self.conn.execute("UPDATE reimbursement_claims SET allocated_amount=1 WHERE id=?", (claim["id"],))
        self.conn.execute(
            "UPDATE reimbursement_settlement_obligations SET claim_count=2,outstanding_amount=1 WHERE id=?",
            (self.obligation,),
        )
        self.conn.execute("DROP TRIGGER money_reimbursement_claims_check")
        self.conn.execute("UPDATE reimbursement_claims SET total_amount_cents=999 WHERE id=?", (claim["id"],))
        codes = self.codes()
        self.assertIn("balance_mismatch", codes)
        self.assertIn("obligation_claim_count", codes)
        self.assertIn("cent_mirror_mismatch", codes)

    def test_stale_statement_amount_is_detected_and_malformed_header_does_not_hide_balances(self):
        self.conn.execute(
            "UPDATE billing_statement_versions SET payload=json_set(payload,'$.statement.totalAmount',99) WHERE id='version-a'"
        )
        report = check_consistency(self.conn)
        issue = next(item for item in report["issues"] if item["code"] == "balance_mismatch")
        self.assertEqual((issue["field"], issue["stored"], issue["expected"]), ("payable_amount", 100, 99))
        self.conn.execute("UPDATE billing_statement_versions SET payload='[]' WHERE id='version-a'")
        self.conn.execute(
            "UPDATE reimbursement_settlement_obligations SET outstanding_amount=1 WHERE id=?", (self.obligation,)
        )
        codes = self.codes()
        self.assertIn("snapshot_invalid", codes)
        self.assertIn("balance_mismatch", codes)
        self.assertNotIn("check_failed", codes)

    def test_non_finite_money_report_is_valid_json(self):
        self.conn.execute(
            "UPDATE reimbursement_settlement_obligations SET payable_amount=?,outstanding_amount=? WHERE id=?",
            (float("inf"), float("inf"), self.obligation),
        )
        report = check_consistency(self.conn)
        self.assertIn("money_invalid", report["summary"]["byCode"])
        json.dumps(report, allow_nan=False)

    def test_excessive_and_orphan_allocations_are_detected(self):
        claim = self.claim(10)
        allocation = self.allocation(claim, 101)
        self.conn.execute("UPDATE reimbursement_allocations SET status='confirmed' WHERE id=?", (allocation["id"],))
        codes = self.codes()
        self.assertIn("funding_line_overallocated", codes)
        self.assertIn("obligation_overallocated", codes)
        self.conn.commit()
        self.conn.execute("PRAGMA foreign_keys=OFF")
        self.conn.execute("DELETE FROM reimbursement_claim_funding_lines WHERE id=?", (claim["fundingLines"][0]["id"],))
        codes = self.codes()
        self.assertIn("foreign_key_violation", codes)
        self.assertIn("allocation_orphan", codes)

    def test_old_database_without_cent_mirrors_is_compatible_and_fraction_is_not_error(self):
        self.conn.execute(
            """INSERT INTO billing_candidate_snapshots(source_type,month,pi,iacucs_json,iacucs_text,
            total_amount,error_message,is_stale,updated_at,source_fingerprint)
            VALUES ('quantity_sheet','2026-06','fraction','[]','',0.005,'',0,'','')"""
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "old.sqlite"
            self.conn.commit()
            with closing(sqlite3.connect(path)) as legacy:
                self.conn.backup(legacy)
                for (table,) in legacy.execute(
                    "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'money_%'"
                ).fetchall():
                    legacy.execute(f'DROP TRIGGER "{table}"')
                for table in (
                    "billing_statements",
                    "billing_statement_lines",
                    "billing_candidate_snapshots",
                    "reimbursement_records",
                    "reimbursement_settlement_obligations",
                    "reimbursement_claims",
                    "reimbursement_claim_funding_lines",
                    "reimbursement_allocations",
                ):
                    for column in legacy.execute(f'PRAGMA table_info("{table}")').fetchall():
                        if column[1].endswith("_cents"):
                            legacy.execute(f'ALTER TABLE "{table}" DROP COLUMN "{column[1]}"')
                legacy.commit()
            report = review_database(path)
            self.assertEqual(report["issues"], [])
            self.assertEqual(len(report["coverage"]["missingCentColumns"]), 22)
            self.assertEqual(
                report["coverage"]["legacyFallbacks"],
                [{"table": "billing_candidate_snapshots", "field": "total_amount", "count": 1}],
            )

    def test_corrupt_snapshots_are_reported_without_repricing_or_cache(self):
        lines = [{"date": "2026-06-01", "amount": 10, "notes": "原样保留" * 1000}]
        replace_billing_statement_version_lines(self.conn, "version-a", lines)
        self.assertEqual(check_consistency(self.conn)["issues"], [])
        self.conn.execute("UPDATE billing_statement_line_blocks SET payload=x'00' WHERE version_id='version-a'")
        self.assertIn("snapshot_invalid", self.codes())
        self.conn.execute("DELETE FROM billing_statement_line_blocks WHERE version_id='version-a'")
        self.assertIn("snapshot_invalid", self.codes())

    def test_incomplete_schema_is_not_reported_clean(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            report = check_consistency(conn)
            self.assertEqual(report["status"], "incomplete")
            self.assertTrue(report["summary"]["incomplete"])

    def test_offline_input_and_report_overwrite_guards_and_cli_exit_codes(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.sqlite"
            report_path = Path(directory) / "report.json"
            self.conn.commit()
            with closing(sqlite3.connect(source)) as target:
                self.conn.backup(target)
            before = fingerprint(source)
            report = review_database(source)
            self.assertTrue(report["inputUnchanged"])
            self.assertEqual(fingerprint(source), before)
            cli = [
                sys.executable,
                "scripts/check_billing_consistency.py",
                "--database",
                str(source),
                "--report",
                str(report_path),
            ]
            self.assertEqual(subprocess.run(cli, capture_output=True, text=True).returncode, 0)
            self.assertEqual(json.loads(report_path.read_text())["status"], "ok")
            saved = report_path.read_bytes()
            self.assertEqual(subprocess.run(cli, capture_output=True, text=True).returncode, 2)
            self.assertEqual(report_path.read_bytes(), saved)
            self.assertEqual(fingerprint(source), before)
            with closing(sqlite3.connect(source)) as conn:
                conn.execute("DELETE FROM billing_statement_versions WHERE id='version-a'")
                conn.commit()
            cli[-1] = str(Path(directory) / "error.json")
            self.assertEqual(subprocess.run(cli, capture_output=True, text=True).returncode, 1)
            Path(str(source) + "-wal").write_bytes(b"pending")
            with self.assertRaisesRegex(ValueError, "WAL"):
                review_database(source)

    def test_source_changes_invalidate_report(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.sqlite"
            self.conn.commit()
            with closing(sqlite3.connect(source)) as conn:
                self.conn.backup(conn)
            original = fingerprint(source)
            with patch("scripts.check_billing_consistency.fingerprint", side_effect=[original, {}]):
                with self.assertRaisesRegex(ValueError, "报告无效"):
                    review_database(source)


if __name__ == "__main__":
    unittest.main()
