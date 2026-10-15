import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from scripts.archive_data_quality_issues import original_inventory
from server_app.domains.data_quality import detection, repository, service
from server_app.legacy import initialize_schema
from server_app.repositories.audit_storage import expand_event
from tests import test_data_quality_archive as fixture


class DataQualityUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.base = fixture.DataQualityArchiveTests()
        self.base.setUp()
        self.conn = self.base.conn
        self.conn.row_factory = sqlite3.Row
        # Finish existing legacy repairs before testing the new scan's write boundary.
        with patch("server_app.persistence.bootstrap.archive_upgrade_issues"):
            initialize_schema(self.conn)
        self.conn.commit()

    def tearDown(self):
        self.base.tearDown()

    def counts(self, conn=None):
        target = conn or self.conn
        return {
            table: target.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                "data_quality_upgrade_runs",
                "data_quality_scans",
                "data_quality_issues",
                "data_quality_observations",
                "audit_events",
            )
        }

    def run_scan(self):
        with self.conn:
            return service.archive_upgrade_issues(self.conn)

    def test_real_schema_entry_archives_current_records_without_changing_old_business_or_audit_rows(self):
        scope, before = original_inventory(self.conn)
        old_audit_count = self.counts()["audit_events"]
        initialize_schema(self.conn)
        self.conn.commit()
        self.assertEqual(original_inventory(self.conn, scope)[1], before)
        counts = self.counts()
        self.assertEqual(counts["data_quality_upgrade_runs"], 1)
        self.assertEqual(counts["data_quality_issues"], 3)
        self.assertEqual(counts["audit_events"], old_audit_count + 1)
        report = repository.completed_upgrade_scan(self.conn, detection.DETECTOR_VERSION)
        self.assertEqual(report["trigger"], "upgrade")
        self.assertEqual(report["actor"]["username"], "system")
        self.assertEqual(report["sourceSnapshot"]["format"], "sqlite-review-inputs-v1")

    def test_repeated_startup_skips_detector_and_fingerprint_and_does_not_append_or_update_archive(self):
        initialize_schema(self.conn)
        self.conn.commit()
        before = list(self.conn.iterdump())
        with (
            patch.object(detection, "detect", side_effect=AssertionError("must not rescan")),
            patch.object(repository, "source_snapshot", side_effect=AssertionError("must not fingerprint")),
        ):
            for _ in range(3):
                initialize_schema(self.conn)
                self.conn.commit()
        self.assertEqual(list(self.conn.iterdump()), before)

    def test_first_upgrade_uses_later_actual_data_and_keeps_new_source_rows_intact(self):
        source = {"id": "later-production-record", "slotId": "new-missing-slot", "status": "active"}
        self.conn.execute(
            "INSERT INTO occupancies(id,slot_id,status,updated_at,payload) VALUES (?,?,?,?,?)",
            (source["id"], source["slotId"], source["status"], "2026-10-14T09:00:00+00:00", json.dumps(source)),
        )
        self.conn.commit()
        result = self.run_scan()
        self.assertEqual(result["summary"]["needsReview"], 4)
        self.assertEqual(result["latestBusinessAt"], "2026-10-14T09:00:00+00:00")
        issue = next(item for item in result["findings"] if item["entityId"] == source["id"])
        self.assertEqual(json.loads(issue["evidence"]["occupancyPayloadText"]), source)
        self.assertEqual(result["sourceSnapshot"]["tables"]["occupancies"], 2)

    def test_later_business_changes_do_not_turn_restart_into_continuous_monitoring(self):
        first = self.run_scan()
        self.base.task("new-task", "deleted-batch", "missing-receipt")
        self.conn.commit()
        before = self.counts()
        second = self.run_scan()
        self.assertTrue(second["reused"])
        self.assertEqual(second["scanId"], first["scanId"])
        self.assertEqual(self.counts(), before)

    def test_next_detector_version_appends_evidence_and_preserves_prior_scan(self):
        first = self.run_scan()
        with patch.object(detection, "DETECTOR_VERSION", "historical-references-test-v2"):
            second = self.run_scan()
            repeated = self.run_scan()
        self.assertNotEqual(first["scanId"], second["scanId"])
        self.assertTrue(repeated["reused"])
        counts = self.counts()
        self.assertEqual(counts["data_quality_upgrade_runs"], 2)
        self.assertEqual(counts["data_quality_issues"], 3)
        self.assertEqual(counts["data_quality_observations"], 6)
        self.assertEqual(repository.existing_scan(self.conn, first["scanId"])["findings"], first["findings"])

    def test_audit_failure_rolls_back_every_archive_row_and_retries_with_caller_changes_preserved(self):
        self.conn.execute("INSERT INTO app_settings VALUES ('caller-pending','true','2026-10-15')")
        before = self.counts()
        with patch.object(service, "write_audit_events", side_effect=RuntimeError("audit failed")):
            with self.assertRaisesRegex(RuntimeError, "audit failed"):
                service.archive_upgrade_issues(self.conn)
        self.assertEqual(self.counts(), before)
        self.assertIsNotNone(self.conn.execute("SELECT 1 FROM app_settings WHERE key='caller-pending'").fetchone())
        result = self.run_scan()
        self.assertFalse(result["reused"])
        self.assertEqual(self.counts()["audit_events"], before["audit_events"] + 1)

    def test_failure_after_audit_and_caller_rollback_both_leave_no_completed_marker(self):
        before = self.counts()
        with patch.object(repository, "complete_upgrade_scan", side_effect=RuntimeError("marker failed")):
            with self.assertRaisesRegex(RuntimeError, "marker failed"):
                service.archive_upgrade_issues(self.conn)
        self.assertEqual(self.counts(), before)
        service.archive_upgrade_issues(self.conn)
        self.conn.rollback()
        self.assertEqual(self.counts(), before)
        self.assertFalse(self.run_scan()["reused"])

    def test_empty_installation_records_completion_once_without_an_empty_business_audit(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            initialize_schema(conn)
            conn.commit()
            counts = self.counts(conn)
            self.assertEqual(counts["data_quality_upgrade_runs"], 1)
            self.assertEqual(counts["data_quality_scans"], 1)
            self.assertEqual(counts["data_quality_issues"], 0)
            self.assertEqual(counts["audit_events"], 0)
            initialize_schema(conn)
            conn.commit()
            self.assertEqual(self.counts(conn), counts)

    def test_clean_existing_business_has_audited_zero_result_and_no_issue_markers(self):
        self.conn.execute("DELETE FROM occupancies")
        self.conn.execute("DELETE FROM placement_tasks")
        self.conn.execute("UPDATE intake_batches SET payload=json_set(payload,'$.cards',json('[]'))")
        self.conn.commit()
        before = self.counts()["audit_events"]
        result = self.run_scan()
        self.assertEqual(result["summary"]["needsReview"], 0)
        self.assertEqual(self.counts()["audit_events"], before + 1)
        self.assertTrue(self.run_scan()["reused"])

    def test_two_startup_connections_only_commit_one_scan_and_one_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "concurrent.sqlite"
            with closing(sqlite3.connect(path)) as conn:
                self.conn.backup(conn)
            barrier = threading.Barrier(2)

            def start():
                with closing(sqlite3.connect(path, timeout=5)) as conn:
                    conn.execute("PRAGMA foreign_keys=ON")
                    barrier.wait(timeout=5)
                    with conn:
                        return service.archive_upgrade_issues(conn)

            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: start(), range(2)))
            self.assertEqual(sorted(item["reused"] for item in results), [False, True])
            with closing(sqlite3.connect(path)) as conn:
                self.assertEqual(self.counts(conn)["data_quality_upgrade_runs"], 1)
                self.assertEqual(self.counts(conn)["audit_events"], self.counts()["audit_events"] + 1)

    def test_live_snapshot_includes_committed_wal_and_ignores_review_audit_and_compression_representation(self):
        before = repository.source_snapshot(self.conn)
        expand_event(self.conn, self.base.event["id"])
        self.conn.commit()
        self.assertEqual(repository.source_snapshot(self.conn), before)
        self.run_scan()
        self.assertEqual(repository.source_snapshot(self.conn), before)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "wal.sqlite"
            with closing(sqlite3.connect(path)) as writer:
                self.conn.backup(writer)
                writer.execute("DELETE FROM data_quality_upgrade_runs")
                writer.commit()
                writer.execute("PRAGMA journal_mode=WAL")
                writer.execute(
                    "INSERT INTO occupancies(id,status,payload) VALUES ('wal-occ','active',?)",
                    (json.dumps({"id": "wal-occ", "status": "active", "slotId": "wal-missing"}),),
                )
                writer.commit()
                self.assertGreater(Path(str(path) + "-wal").stat().st_size, 0)
                with closing(sqlite3.connect(path)) as conn:
                    with conn:
                        result = service.archive_upgrade_issues(conn)
                    self.assertEqual(result["summary"]["needsReview"], 4)
                    self.assertNotEqual(result["sourceSha256"], before["sha256"])

    def test_missing_or_corrupt_completed_evidence_fails_without_silently_archiving_again(self):
        first = self.run_scan()
        self.conn.execute("UPDATE data_quality_observations SET evidence_json='{}'")
        self.conn.commit()
        before = self.counts()
        with self.assertRaisesRegex(ValueError, "校验失败"):
            self.run_scan()
        self.assertEqual(self.counts(), before)
        self.assertEqual(
            self.conn.execute("SELECT scan_id FROM data_quality_upgrade_runs").fetchone()[0], first["scanId"]
        )


if __name__ == "__main__":
    unittest.main()
