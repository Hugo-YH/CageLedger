import argparse
import copy
import json
import os
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from scripts.database_review import runner
from scripts.database_review.exports import clean_calculation
from scripts.database_review.http_checks import (
    normalize_obligation,
    normalize_sync_event,
    plaintext_audit_facts,
    source_audit_facts,
)
from scripts.database_review.storage import (
    backup_copy,
    digest,
    fingerprint,
    immutable_connection,
    offline_input,
    original_records,
    private_output,
    require_original_rows,
    source_scope,
    write_json,
)
from scripts.verify_database_copy import pdf_mode


class DatabaseCopyReviewTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "source.sqlite"
        self.code = self.root / "code"
        self.code.mkdir()
        with closing(sqlite3.connect(self.source)) as conn:
            conn.execute("CREATE TABLE records(id TEXT PRIMARY KEY,value TEXT,amount REAL,blob BLOB)")
            conn.execute("INSERT INTO records VALUES('original','完整正文',12.34,?)", (b"\x00\xff",))
            conn.commit()

    def test_offline_backup_keeps_all_input_files_unchanged_and_private(self):
        source, before = offline_input(self.source)
        copied = self.root / "copied.sqlite"
        backup_copy(source, copied)
        self.assertEqual(fingerprint(source), before)
        self.assertEqual(copied.stat().st_mode & 0o777, 0o600)
        with closing(immutable_connection(source)) as conn:
            scope = source_scope(conn)
            self.assertEqual(original_records(conn, scope), {name: spec["rows"] for name, spec in scope.items()})
        with closing(sqlite3.connect(copied)) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("UPDATE records SET value='copy only'")
            self.assertNotEqual(original_records(conn, scope)["records"], scope["records"]["rows"])
        self.assertEqual(fingerprint(source), before)

    def test_nonempty_wal_or_journal_is_rejected_before_output(self):
        for suffix in ("-wal", "-journal"):
            with self.subTest(suffix=suffix):
                path = Path(str(self.source) + suffix)
                path.write_bytes(b"unmerged")
                with self.assertRaisesRegex(ValueError, "不能忽略"):
                    offline_input(self.source)
                self.assertEqual(path.read_bytes(), b"unmerged")
                path.unlink()

    def test_output_rejects_existing_paths_repository_and_ancestors(self):
        existing = self.root / "existing"
        existing.mkdir()
        sentinel = existing / "keep.txt"
        sentinel.write_text("preserve")
        for output in (existing, self.code / "reports", self.source):
            with self.subTest(output=output), self.assertRaises(ValueError):
                private_output(output, self.source, self.code)
        self.assertEqual(sentinel.read_text(), "preserve")
        output = private_output(self.root / "new-private", self.source, self.code)
        self.assertEqual(output.stat().st_mode & 0o777, 0o700)
        file = output / "report.json"
        write_json(file, {"ok": True})
        self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            write_json(file, {"ok": False})

    def test_composite_null_keys_and_without_rowid_tables_do_not_hide_records(self):
        with closing(sqlite3.connect(self.source)) as conn:
            conn.executescript(
                "CREATE TABLE nullable(a TEXT,b TEXT,PRIMARY KEY(a,b)); INSERT INTO nullable VALUES(NULL,'x'); INSERT INTO nullable VALUES(NULL,'x'); CREATE TABLE keyed(a TEXT PRIMARY KEY,b TEXT) WITHOUT ROWID; INSERT INTO keyed VALUES('a','b');"
            )
            conn.row_factory = sqlite3.Row
            scope = source_scope(conn)
            self.assertEqual(len(scope["nullable"]["rows"]), 2)
            self.assertEqual(len(scope["keyed"]["rows"]), 1)
            records = original_records(conn, scope)
            require_original_rows(records, scope)
            conn.execute("DELETE FROM nullable WHERE rowid=1")
            with self.assertRaisesRegex(ValueError, "原有记录缺失"):
                require_original_rows(original_records(conn, scope), scope)

    def test_original_projection_detects_deletion_money_and_text_changes(self):
        with closing(immutable_connection(self.source)) as conn:
            scope = source_scope(conn)
        for sql in ("DELETE FROM records", "UPDATE records SET amount=12.35", "UPDATE records SET value='丢失正文'"):
            with self.subTest(sql=sql), closing(sqlite3.connect(self.source)) as conn:
                conn.row_factory = sqlite3.Row
                conn.execute(sql)
                records = original_records(conn, scope)
                self.assertNotEqual(records["records"], scope["records"]["rows"])
                conn.rollback()

    def test_sync_normalization_keeps_money_business_dates_and_before_snapshot(self):
        event = {
            "id": "random",
            "at": "now",
            "action": "reimbursement_ledger.obligation_snapshot_synced",
            "before": {"updatedAt": "historical", "payableAmount": 10},
            "after": {"updatedAt": "now", "payableAmount": 20, "month": "2099-10"},
        }
        normalized = normalize_sync_event(event)
        self.assertEqual(normalized["before"]["updatedAt"], "historical")
        changed = copy.deepcopy(event)
        changed["after"]["payableAmount"] = 21
        self.assertNotEqual(normalized, normalize_sync_event(changed))
        self.assertEqual(normalized["after"]["month"], "2099-10")
        item = {"id": "old", "createdAt": "historical", "updatedAt": "now", "workflowId": "w", "payableAmount": 20}
        self.assertEqual(normalize_obligation(item, {"old"}, {"old"})["createdAt"], "historical")
        self.assertIn("updatedAt", normalize_obligation(item, {"old"}, set()))
        self.assertNotIn("id", normalize_obligation({**item, "id": "new"}, {"old"}, set()))

    def test_plaintext_audit_is_an_independent_reference_and_invalid_json_fails(self):
        event = {"id": "audit", "before": {"text": "完整之前"}, "after": {"text": "完整之后"}}
        self.assertEqual(plaintext_audit_facts([("audit", json.dumps(event))]), {"audit": digest(event)})
        with self.assertRaises(json.JSONDecodeError):
            plaintext_audit_facts([("audit", "bad JSON")])

    def test_source_audit_reference_decodes_existing_blocks_without_treating_summaries_as_fulltext(self):
        import hashlib
        import zlib

        event = {"id": "audit", "before": None, "after": {"complete": "原始完整内容" * 1000}}
        raw = json.dumps({"eventId": "audit", "payload": json.dumps(event)}).encode()
        summary = json.dumps(
            {"id": "audit", "before": None, "after": {"truncated": True}, "_auditStorage": "zlib-audit-json-v1"}
        )
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.executescript(
                "CREATE TABLE audit_events(id TEXT,payload TEXT); CREATE TABLE audit_event_payload_blocks(event_id TEXT,codec TEXT,raw_bytes INTEGER,raw_sha256 TEXT,payload BLOB);"
            )
            conn.execute("INSERT INTO audit_events VALUES('audit',?)", (summary,))
            self.assertEqual(plaintext_audit_facts([("audit", summary)]), {})
            with self.assertRaisesRegex(ValueError, "压缩块缺失"):
                source_audit_facts(conn)
            conn.execute(
                "INSERT INTO audit_event_payload_blocks VALUES('audit','zlib-audit-json-v1',?,?,?)",
                (len(raw), hashlib.sha256(raw).hexdigest(), zlib.compress(raw)),
            )
            self.assertEqual(source_audit_facts(conn), {"audit": digest(event)})
            conn.execute("UPDATE audit_event_payload_blocks SET payload=?", (zlib.compress(raw[:-1] + b"x"),))
            with self.assertRaisesRegex(ValueError, "校验失败"):
                source_audit_facts(conn)

    def test_pdf_sampling_cannot_silently_skip_validation(self):
        for value in ("1", "3", "all"):
            self.assertEqual(pdf_mode(value), value)
        for value in ("0", "-1", "none"):
            with self.assertRaises(argparse.ArgumentTypeError):
                pdf_mode(value)

    def fake_checks(self):
        with closing(immutable_connection(self.source)) as conn:
            scope = source_scope(conn)
            records = original_records(conn, scope)
        return {
            "migration": records,
            "afterReads": records,
            "auditFacts": {},
            "auditReadableCount": 0,
            "auditReadableAfterReads": 0,
            "bills": {
                "snapshots": {},
                "html": {},
                "xlsx": {},
                "pdf": {},
                "coverage": {"bills": 0, "pdf": 0, "html": 0, "xlsx": 0, "lineRows": 0, "pdfMode": "3"},
            },
            "quantityHtml": {},
            "calculations": {"group": "amount=300"},
            "http": {"requests": 5, "syncAudits": []},
            "consistency": {"summary": {"warnings": 0, "errors": 0, "incomplete": False}},
            "historicalFindings": {"needsReview": 0},
        }

    def review(self, worker, *, code_fingerprints=None):
        baseline = self.root / "baseline-code"
        baseline.mkdir()
        with (
            patch.object(runner, "baseline_checkout", return_value=("baseline-sha", baseline)),
            patch.object(
                runner, "code_fingerprint", side_effect=code_fingerprints or [{"code": "same"}, {"code": "same"}]
            ),
            patch.object(runner.subprocess, "check_output", return_value="current-sha"),
            patch.object(runner, "run_worker", side_effect=worker),
        ):
            return runner.review(self.source, self.root / "result", self.code, "HEAD")

    def fake_worker(self, _worker, request_path, _log, _timeout):
        request = json.loads(request_path.read_text())
        write_json(request["result"], {"completed": True, "checks": self.fake_checks()})
        self.assertNotEqual(Path(request["database"]).resolve(), self.source.resolve())
        return 0

    def test_runner_passes_only_complete_equal_results_and_preserves_input(self):
        before = fingerprint(self.source)
        result = self.review(self.fake_worker)
        self.assertTrue(result["completed"])
        self.assertEqual(result["status"], "passed")
        self.assertTrue(result["inputUnchanged"])
        self.assertEqual(fingerprint(self.source), before)

    def test_different_audit_money_or_missing_result_cannot_pass(self):
        def worker(*args):
            request = json.loads(args[1].read_text())
            checks = self.fake_checks()
            if request["case"] == "current":
                checks["calculations"]["group"] = "amount=301"
            write_json(request["result"], {"completed": True, "checks": checks})
            return 0

        result = self.review(worker)
        self.assertEqual(result["status"], "different")
        self.assertIn("/calculations/group", result["differences"])

    def test_failed_or_incomplete_worker_retains_evidence_and_nonpassing_status(self):
        result = self.review(lambda *_args: 1)
        self.assertFalse(result["completed"])
        self.assertEqual(result["status"], "incomplete")
        self.assertTrue((self.root / "result/report.json").is_file())
        self.assertTrue(result["inputUnchanged"])

    def test_completed_flag_with_empty_coverage_does_not_pass(self):
        def worker(*args):
            request = json.loads(args[1].read_text())
            write_json(request["result"], {"completed": True, "checks": {}})
            return 0

        result = self.review(worker)
        self.assertEqual(result["status"], "incomplete")

    def test_equal_export_counts_cannot_substitute_other_source_ids(self):
        with closing(sqlite3.connect(self.source)) as conn:
            for table in ("quantity_sheets", "billing_statement_versions", "audit_events"):
                conn.execute(f"CREATE TABLE {table}(id TEXT PRIMARY KEY,payload TEXT)")
                conn.executemany(f"INSERT INTO {table} VALUES (?,?)", [("a", "{}"), ("b", "{}")])
            conn.commit()
        with closing(immutable_connection(self.source)) as conn:
            scope = source_scope(conn)
        checks = self.fake_checks()
        checks.update(
            auditFacts={"a": "hash", "b": "hash"},
            auditReadableCount=2,
            auditReadableAfterReads=2,
            quantityHtml={"a": "hash", "b": "hash"},
        )
        checks["bills"] = {key: {"a": "hash", "b": "hash"} for key in ("snapshots", "html", "xlsx", "pdf")}
        checks["bills"]["coverage"] = {"bills": 2, "html": 2, "xlsx": 2, "pdf": 2, "lineRows": 0}
        runner.validate_checks(checks, scope, "all")
        for key in ("auditFacts", "quantityHtml", "snapshots", "html", "xlsx", "pdf"):
            changed = copy.deepcopy(checks)
            target = changed[key] if key in ("auditFacts", "quantityHtml") else changed["bills"][key]
            target["substitute"] = target.pop("b")
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "ID"):
                runner.validate_checks(changed, scope, "all")

    def test_fingerprint_covers_dependency_manifests_restore_tools_and_runtime_versions(self):
        subprocess.run(["git", "init", "-q", str(self.code)], check=True)
        files = (
            "package.json",
            "package-lock.json",
            "requirements.txt",
            "requirements-dev.txt",
            ".python-version",
            ".nvmrc",
            "vite.config.ts",
            "scripts/python_runtime.mjs",
            "scripts/restore_drill/worker.py",
        )
        for name in files:
            path = self.code / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("original")
        before = runner.code_fingerprint(self.code)
        for name in files:
            path = self.code / name
            path.write_text("changed")
            self.assertNotEqual(runner.code_fingerprint(self.code), before, name)
            path.write_text("original")
        package = self.code / "node_modules/react/package.json"
        package.parent.mkdir(parents=True)
        package.write_text('{"version":"19.2.7"}')
        installed = runner.code_fingerprint(self.code)
        package.write_text('{"version":"19.2.8"}')
        self.assertNotEqual(runner.code_fingerprint(self.code), installed)
        with patch.object(runner.sys, "version", "3.13.changed"):
            self.assertNotEqual(runner.code_fingerprint(self.code), before)

    def test_source_or_code_change_during_review_invalidates_result(self):
        def worker(*args):
            with closing(sqlite3.connect(self.source)) as conn:
                conn.execute("UPDATE records SET value='changed outside the reviewer'")
                conn.commit()
            return self.fake_worker(*args)

        result = self.review(worker, code_fingerprints=[{"code": "before"}, {"code": "after"}])
        self.assertFalse(result["inputUnchanged"])
        self.assertFalse(result["codeUnchanged"])
        self.assertNotIn(result["status"], ("passed", "passed_with_warnings"))

    def test_runtime_or_fingerprint_capture_failure_always_leaves_a_nonpassing_report(self):
        for phase in ("runtime", "before", "after"):
            with self.subTest(phase=phase):
                evidence = self.root / ("evidence-" + phase)
                if (self.root / "result").exists():
                    (self.root / "result").rename(evidence)
                baseline = self.root / "baseline-code"
                if baseline.exists():
                    baseline.rmdir()
                if phase == "runtime":
                    with patch.object(runner, "runtime_environment", side_effect=OSError("runtime probe failed")):
                        result = self.review(self.fake_worker)
                else:
                    snapshots = (
                        [OSError("before probe failed"), {}]
                        if phase == "before"
                        else [{}, OSError("after probe failed")]
                    )
                    result = self.review(self.fake_worker, code_fingerprints=snapshots)
                self.assertEqual(result["status"], "incomplete")
                self.assertFalse(result["completed"])
                self.assertFalse(result["codeUnchanged"])
                self.assertTrue(result["inputUnchanged"])
                self.assertTrue((self.root / "result/report.json").is_file())
                self.assertTrue((self.root / "result/report.md").is_file())

    def test_worker_environment_does_not_inherit_database_paths_or_credentials(self):
        with patch.dict(
            os.environ,
            {
                "CAGELEDGER_DB": str(self.source),
                "CAGELEDGER_GITEA_TOKEN": "secret",
                "CAGELEDGER_DATA_ROOT": "/production",
                "PYTHONPATH": "/wrong/code",
            },
        ):
            env = runner.worker_environment(self.root / "private/db.sqlite", self.root / "private")
        self.assertEqual(env["CAGELEDGER_DB"], str(self.root / "private/db.sqlite"))
        self.assertEqual(env["CAGELEDGER_GITEA_TOKEN"], "")
        self.assertNotIn("PYTHONPATH", env)

    def test_only_new_preview_metadata_is_normalized_away(self):
        statement = {
            "id": "new",
            "generatedAt": "now",
            "lockedAt": "historical",
            "month": "2099-10",
            "totalAmount": 300,
        }
        cleaned, _ = clean_calculation(statement, [{"id": "new-line", "date": "2099-10-01", "amount": 300}])
        self.assertNotIn("generatedAt", cleaned)
        self.assertEqual(cleaned["lockedAt"], "historical")
        issued = {**statement, "workflowId": "issued"}
        cleaned, _ = clean_calculation(issued, [])
        self.assertEqual(cleaned, issued)


if __name__ == "__main__":
    unittest.main()
