import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from scripts.archive_data_quality_issues import archive_copy, original_inventory
from server_app.domains.administration.audit import audit_event, write_audit_events
from server_app.domains.data_quality.detection import detect
from server_app.domains.data_quality.repository import existing_scan
from server_app.domains.data_quality.service import archive_issues
from server_app.legacy import initialize_schema
from server_app.persistence.data_quality import ensure_schema

ACTOR = {"id": "reviewer", "username": "reviewer", "displayName": "副本核查测试"}
SOURCE_HASH = "a" * 64
AT = "2026-10-10T13:16:54+00:00"


class DataQualityArchiveTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        with patch("server_app.persistence.bootstrap.archive_upgrade_issues"):
            initialize_schema(self.conn)
        self.conn.row_factory = None
        for identity in ("batch-a", "batch-b"):
            batch = {
                "id": identity,
                "status": "received",
                "receipts": [],
                "intakeDate": "2026-10-20",
                "cards": [
                    {"id": identity + "-card", "index": 1, "qrId": "Z2026001-20260527-01"},
                ],
            }
            self.conn.execute(
                "INSERT INTO intake_batches(id,batch_no,status,updated_at,payload) VALUES (?,?,?,?,?)",
                (identity, identity, "received", AT, json.dumps(batch)),
            )
        self.conn.execute(
            "INSERT INTO occupancies(id,slot_id,status,payload) VALUES (?,?,?,?)",
            ("occ", "missing-slot", "active", json.dumps({"id": "occ", "slotId": "missing-slot", "status": "active"})),
        )
        self.task("task", "batch-a", "old-receipt")
        self.receipt = {"id": "old-receipt", "cardCount": 2, "receiptDate": "2026-05-27", "unknownField": "保留"}
        self.event = audit_event(
            ACTOR,
            "intake_batch.updated",
            "intake_batch",
            "batch-a",
            "历史接收",
            [],
            AT,
            None,
            {
                "id": "batch-a",
                "receipts": [self.receipt],
                "notes": "原审计内容" * 1000,
            },
        )
        write_audit_events(self.conn, [self.event])
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def task(self, identity, batch, receipt):
        item = {"id": identity, "sourceBatchId": batch, "sourceReceiptId": receipt, "status": "pending"}
        self.conn.execute(
            "INSERT INTO placement_tasks(id,source_batch_id,source_receipt_id,planned_move_in_date,status,payload) "
            "VALUES (?,?,?,?,?,?)",
            (identity, batch, receipt, "2026-10-20", "pending", json.dumps(item)),
        )

    def archive(self, source_hash=SOURCE_HASH):
        return archive_issues(self.conn, source_sha256=source_hash, actor=ACTOR)

    def test_archive_preserves_all_old_rows_and_retains_compressed_audit_receipt_evidence(self):
        scope, before = original_inventory(self.conn)
        result = self.archive()
        self.assertEqual(result["summary"]["needsReview"], 3)
        self.assertEqual(result["latestBusinessAt"], AT)
        self.assertEqual(original_inventory(self.conn, scope)[1], before)
        receipt = next(f for f in result["findings"] if f["code"] == "placement_missing_receipt")
        self.assertEqual(
            receipt["evidence"]["historicalReceiptSnapshots"],
            [
                {
                    "auditEventId": self.event["id"],
                    "at": AT,
                    "phase": "after",
                    "receipt": self.receipt,
                }
            ],
        )
        self.assertEqual(existing_scan(self.conn, result["scanId"])["findings"], result["findings"])
        row = self.conn.execute("SELECT actor_user_id,action FROM audit_events ORDER BY rowid DESC LIMIT 1").fetchone()
        self.assertEqual(row, (ACTOR["id"], "data_quality.issues_archived"))

    def test_retry_is_idempotent_and_repeated_schema_does_not_write(self):
        first = self.archive()
        before = list(self.conn.iterdump())
        changes = self.conn.total_changes
        second = self.archive()
        ensure_schema(self.conn)
        self.assertTrue(second["reused"])
        self.assertEqual(second["scanId"], first["scanId"])
        self.assertEqual(list(self.conn.iterdump()), before)
        self.assertEqual(self.conn.total_changes, changes)

    def test_new_source_appends_observations_without_duplicating_issue_or_losing_prior_evidence(self):
        first = self.archive()
        second = self.archive("b" * 64)
        self.assertNotEqual(first["scanId"], second["scanId"])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM data_quality_issues").fetchone()[0], 3)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM data_quality_observations").fetchone()[0], 6)
        self.assertEqual(existing_scan(self.conn, first["scanId"])["findings"], first["findings"])

    def test_rescan_does_not_silently_resolve_previously_flagged_records(self):
        first = self.archive()
        self.conn.execute("DELETE FROM occupancies WHERE id='occ'")
        second = self.archive("b" * 64)
        self.assertEqual(second["summary"]["needsReview"], 2)
        issue = next(f for f in first["findings"] if f["entityId"] == "occ")
        self.assertEqual(
            self.conn.execute(
                "SELECT review_status,last_scan_id FROM data_quality_issues WHERE id=?", (issue["id"],)
            ).fetchone(),
            ("needs_review", first["scanId"]),
        )

    def test_bulk_received_without_receipts_is_not_flagged_but_wrong_parent_receipt_is(self):
        self.conn.execute("DELETE FROM placement_tasks")
        result = detect(self.conn)
        self.assertNotIn("placement_missing_receipt", result["summary"]["byCode"])
        self.task("wrong-parent", "batch-b", "old-receipt")
        item = next(f for f in detect(self.conn)["findings"] if f["code"] == "placement_missing_receipt")
        self.assertEqual(item["evidence"]["historicalReceiptSnapshots"], [])
        self.task("missing-parent", "deleted-batch", "receipt")
        self.assertEqual(detect(self.conn)["summary"]["byCode"]["placement_missing_batch"], 1)

    def test_evidence_corruption_fails_and_audit_failure_rolls_back_registry_with_caller_changes_intact(self):
        self.conn.execute("INSERT INTO app_settings VALUES ('pending','true',?)", (AT,))
        with patch(
            "server_app.domains.data_quality.service.write_audit_events", side_effect=RuntimeError("audit failed")
        ):
            with self.assertRaises(RuntimeError):
                self.archive()
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM data_quality_issues").fetchone()[0], 0)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM data_quality_scans").fetchone()[0], 0)
        self.assertIsNotNone(self.conn.execute("SELECT 1 FROM app_settings WHERE key='pending'").fetchone())
        self.archive()
        self.conn.execute("UPDATE data_quality_observations SET evidence_json='{}'")
        with self.assertRaisesRegex(ValueError, "校验失败"):
            self.archive()

    def test_orphan_obligation_is_retained_and_confirmed_allocation_escalates_review(self):
        self.conn.execute(
            "INSERT INTO reimbursement_settlement_obligations "
            "(id,workflow_id,statement_version_id,month,source_pi,iacuc,created_at,updated_at,payload) "
            "VALUES ('orphan','deleted-workflow','old-version','2026-10','PI','IACUC',?,?, '{}')",
            (AT, AT),
        )
        first = self.archive()
        self.assertEqual(first["summary"]["retainedHistory"], 1)
        self.conn.execute(
            "INSERT INTO reimbursement_claims(id,document_number,created_by,created_by_name,created_at,updated_at,payload) "
            "VALUES ('claim','claim','reviewer','test',?,?,'{}')",
            (AT, AT),
        )
        self.conn.execute(
            "INSERT INTO reimbursement_claim_funding_lines "
            "(id,claim_id,fund_book_no,funding_owner,created_at,updated_at,payload) "
            "VALUES ('fund','claim','F1','test',?,?,'{}')",
            (AT, AT),
        )
        self.conn.execute(
            "INSERT INTO reimbursement_allocations "
            "(id,funding_line_id,obligation_id,amount,status,created_by,created_by_name,created_at,updated_at,payload) "
            "VALUES ('allocation','fund','orphan',1,'confirmed','reviewer','test',?,?,'{}')",
            (AT, AT),
        )
        second = self.archive("b" * 64)
        self.assertEqual(second["summary"]["retainedHistory"], 0)
        self.assertEqual(second["summary"]["needsReview"], 4)
        self.assertEqual(
            self.conn.execute("SELECT review_status FROM data_quality_issues WHERE entity_id='orphan'").fetchone()[0],
            "needs_review",
        )

    def test_offline_tool_only_writes_new_copy_with_private_permissions_and_leaves_input_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output, report = [
                Path(directory) / name for name in ("source.sqlite", "marked.sqlite", "review.json")
            ]
            with closing(sqlite3.connect(source)) as conn:
                self.conn.backup(conn)
            before = source.read_bytes()
            result = archive_copy(source, output, report, actor_name=ACTOR["displayName"])
            self.assertTrue(result["originalRowsUnchanged"])
            self.assertEqual(result["summary"]["needsReview"], 3)
            self.assertEqual(source.read_bytes(), before)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(report.stat().st_mode & 0o777, 0o600)
            with closing(sqlite3.connect(output)) as conn:
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM data_quality_issues").fetchone()[0], 3)
            with self.assertRaises(ValueError):
                archive_copy(source, source, report, actor_name="reviewer")
            with self.assertRaises(ValueError):
                archive_copy(source, output, report, actor_name="reviewer")

    def test_tool_rejects_nonempty_wal_and_cleans_failed_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output, report = [
                Path(directory) / name for name in ("source.sqlite", "marked.sqlite", "review.json")
            ]
            with closing(sqlite3.connect(source)) as conn:
                self.conn.backup(conn)
            wal = Path(str(source) + "-wal")
            wal.write_bytes(b"pending writes")
            with self.assertRaisesRegex(ValueError, "WAL"):
                archive_copy(source, output, report, actor_name="reviewer")
            self.assertFalse(output.exists())
            wal.unlink()
            with patch("scripts.archive_data_quality_issues.archive_issues", side_effect=ValueError("failed scan")):
                with self.assertRaisesRegex(ValueError, "failed scan"):
                    archive_copy(source, output, report, actor_name="reviewer")
            self.assertFalse(output.exists())
            self.assertFalse(report.exists())

    def test_tool_rejects_accidental_business_changes_and_source_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output, report = [
                Path(directory) / name for name in ("source.sqlite", "marked.sqlite", "review.json")
            ]
            with closing(sqlite3.connect(source)) as conn:
                self.conn.backup(conn)
            before = source.read_bytes()

            def accidental_update(conn, **kwargs):
                result = archive_issues(conn, **kwargs)
                conn.execute("UPDATE intake_batches SET status='draft'")
                return result

            with patch("scripts.archive_data_quality_issues.archive_issues", side_effect=accidental_update):
                with self.assertRaisesRegex(ValueError, "改变了原有业务"):
                    archive_copy(source, output, report, actor_name="reviewer")
            self.assertFalse(output.exists())
            self.assertFalse(report.exists())
            self.assertEqual(source.read_bytes(), before)
            from scripts.check_billing_consistency import fingerprint

            initial = fingerprint(source)
            with patch("scripts.archive_data_quality_issues.fingerprint", side_effect=[initial, {}]):
                with self.assertRaisesRegex(ValueError, "输入在核查期间变化"):
                    archive_copy(source, output, report, actor_name="reviewer")
            self.assertFalse(output.exists())
            self.assertFalse(report.exists())
            self.assertEqual(source.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
