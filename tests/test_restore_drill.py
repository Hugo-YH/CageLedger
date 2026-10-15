import json
import os
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from scripts.database_review.storage import fingerprint, immutable_connection, source_scope, write_json
from scripts.restore_drill import runner
from scripts.restore_drill.files import copy_file, copy_tree, file_fact, inventory, relative_path, safe_input
from scripts.restore_drill.references import references, validate_references
from scripts.restore_drill.worker import block_external_network


class RestoreDrillTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.files = self.root / "files"
        (self.files / "quarantine").mkdir(parents=True)
        (self.files / "empty-history-directory").mkdir()
        (self.files / "quarantine/original.tif").write_bytes(b"original-image\x00\xff")
        (self.files / "quarantine/report-v1.docx").write_bytes(b"historical-word")
        (self.files / "quarantine/unreferenced.txt").write_text("保留历史资料")
        self.database = self.root / "source.sqlite"
        with closing(sqlite3.connect(self.database)) as conn:
            conn.executescript(
                "CREATE TABLE records(id TEXT PRIMARY KEY,payload TEXT); INSERT INTO records VALUES('a','完整');"
            )
            conn.commit()
        self.code = self.root / "code"
        (self.code / "scripts/restore_drill").mkdir(parents=True)
        (self.code / "scripts/verify_restore.py").write_text("# stable")
        (self.code / "package.json").write_text("{}")

    def test_backup_and_restore_preserve_every_byte_and_empty_directory(self):
        before = inventory(self.files)
        bundle, restored = self.root / "bundle", self.root / "restored"
        copy_tree(self.files, bundle, before)
        copy_tree(bundle, restored, before)
        self.assertEqual(inventory(restored), before)
        self.assertTrue((restored / "empty-history-directory").is_dir())
        self.assertEqual((restored / "quarantine/report-v1.docx").read_bytes(), b"historical-word")
        self.assertEqual((restored / "quarantine/unreferenced.txt").read_text(), "保留历史资料")
        (restored / "quarantine/original.tif").write_bytes(b"only restore changes")
        self.assertEqual(inventory(self.files), before)
        self.assertEqual(inventory(bundle), before)
        self.assertEqual((bundle / "quarantine/original.tif").stat().st_mode & 0o777, 0o600)
        self.assertEqual(bundle.stat().st_mode & 0o777, 0o700)

    def test_same_size_corruption_is_not_accepted_and_targets_are_not_overwritten(self):
        source = self.files / "quarantine/original.tif"
        fact = file_fact(source)
        target = self.root / "copy"
        copy_file(source, target, fact)
        with self.assertRaises(FileExistsError):
            copy_file(source, target, fact)
        source.write_bytes(b"x" * fact["bytes"])
        with self.assertRaisesRegex(ValueError, "清单不一致"):
            copy_file(source, self.root / "corrupt", fact)

    def test_symbolic_links_and_special_files_are_rejected(self):
        link = self.files / "link"
        link.symlink_to(self.database)
        with self.assertRaisesRegex(ValueError, "符号链接"):
            inventory(self.files)
        with self.assertRaisesRegex(ValueError, "符号链接"):
            safe_input(link)
        with self.assertRaisesRegex(ValueError, "符号链接"):
            safe_input(link / "nested")
        link.unlink()
        os.mkfifo(self.files / "fifo")
        with self.assertRaisesRegex(ValueError, "特殊文件"):
            inventory(self.files)

    def test_reference_paths_reject_escape_and_do_not_normalize_it_away(self):
        for value in ("", "/outside", "../x", "a/../b", "a//b", "./x", "a\\b", "a/"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                relative_path(value)
        self.assertEqual(str(relative_path("quarantine/report-v1.docx")), "quarantine/report-v1.docx")

    def make_reference_tables(self):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        conn.row_factory = sqlite3.Row
        conn.executescript("""
            CREATE TABLE quarantine_attachments(id TEXT,payload TEXT);
            CREATE TABLE quarantine_reports(id TEXT,payload TEXT);
            CREATE TABLE feedback(id TEXT,status TEXT);
            CREATE TABLE feedback_comments(id TEXT,visible INTEGER);
            CREATE TABLE feedback_attachments(id TEXT,feedback_id TEXT,comment_id TEXT,source TEXT,
                storage_name TEXT,visible INTEGER,size INTEGER);
            CREATE TABLE inspection_catalog_nodes(config_json TEXT);
            CREATE TABLE inspection_catalog_versions(payload TEXT);
            CREATE TABLE reimbursement_claim_attachments(id TEXT,claim_id TEXT,stored_name TEXT,size_bytes INTEGER,sha256 TEXT);
            CREATE TABLE billing_workflow_attachments(id TEXT,workflow_id TEXT,stored_name TEXT,size_bytes INTEGER,sha256 TEXT);
            CREATE TABLE animal_inspection_attachments(id TEXT,inspection_id TEXT,stored_name TEXT,size_bytes INTEGER);
        """)
        return conn

    def test_all_attachment_families_and_historical_catalog_versions_are_covered(self):
        conn = self.make_reference_tables()
        for table, parent in (
            ("reimbursement_claim_attachments", "claim"),
            ("billing_workflow_attachments", "workflow"),
        ):
            conn.execute(f"INSERT INTO {table} VALUES('id',?,'file.pdf',10,'sha')", (parent,))
        conn.execute("INSERT INTO animal_inspection_attachments VALUES('photo','inspection','photo.png',20)")
        conn.execute("INSERT INTO feedback VALUES('f','open')")
        conn.execute("INSERT INTO feedback_attachments VALUES('local','f',NULL,'local','local.png',1,10)")
        conn.execute("INSERT INTO feedback_attachments VALUES('remote','f',NULL,'gitea','',1,10)")
        for table, data in (
            (
                "quarantine_attachments",
                {"storageName": "original.tif", "previewStorageName": "preview.png", "size": 10},
            ),
            ("quarantine_reports", {"storageName": "report-v1.docx"}),
        ):
            conn.execute(f"INSERT INTO {table} VALUES('id',?)", (json.dumps(data),))
        images = {"referenceImages": [{"url": "/downloads/images/catalog.png"}]}
        conn.execute("INSERT INTO inspection_catalog_nodes VALUES(?)", (json.dumps(images),))
        conn.execute(
            "INSERT INTO inspection_catalog_versions VALUES(?)",
            (
                json.dumps(
                    {"nodes": [{"config": images}, {"config": {"referenceImages": [{"url": "/old/history.png"}]}}]}
                ),
            ),
        )
        refs = references(conn)
        self.assertEqual(len(refs["local"]), 9)
        self.assertEqual(len(refs["remote"]), 1)
        self.assertEqual(sum(item["path"].endswith("catalog.png") for item in refs["local"]), 1)
        self.assertIn("animal-inspections/reference-images/history.png", [item["path"] for item in refs["local"]])
        self.assertEqual(
            next(item for item in refs["local"] if item["kind"] == "workflow")["endpoint"],
            "/api/billing-workflows/attachments/id",
        )
        self.assertTrue(next(item for item in refs["local"] if item["kind"] == "quarantine-reports")["conversion"])

    def test_hidden_and_removed_assets_are_retained_without_bypassing_visibility(self):
        conn = self.make_reference_tables()
        conn.execute(
            "INSERT INTO quarantine_attachments VALUES('hidden',?)",
            (json.dumps({"storageName": "hidden.png", "removed": True}),),
        )
        conn.execute("INSERT INTO feedback VALUES('f','deleted')")
        conn.execute("INSERT INTO feedback_attachments VALUES('hidden','f',NULL,'local','hidden.png',1,10)")
        conn.execute("INSERT INTO feedback_attachments VALUES('cached','f',NULL,'gitea','cached.png',1,10)")
        refs = references(conn)
        self.assertEqual(len(refs["local"]), 3)
        self.assertTrue(all(item["endpoint"] is None for item in refs["local"]))
        self.assertEqual(len(refs["remote"]), 1)

    def test_invalid_stored_names_fail_instead_of_reading_outside_backup(self):
        conn = self.make_reference_tables()
        for name in ("../secret", "/absolute", "sub/name", "a\\b"):
            with self.subTest(name=name):
                conn.execute("DELETE FROM quarantine_attachments")
                conn.execute("INSERT INTO quarantine_attachments VALUES('bad',?)", (json.dumps({"storageName": name}),))
                with self.assertRaises(ValueError):
                    references(conn)

    def test_missing_size_and_digest_errors_are_distinct(self):
        refs = {
            "local": [
                {"kind": "q", "id": "missing", "path": "missing", "size": None, "sha256": None},
                {"kind": "q", "id": "size", "path": "size", "size": 10, "sha256": None},
                {"kind": "q", "id": "digest", "path": "digest", "size": 10, "sha256": "original"},
            ]
        }
        issues = validate_references(
            refs, {"files": {"size": {"bytes": 9}, "digest": {"bytes": 10, "sha256": "corrupt"}}}
        )
        self.assertEqual([i["reason"] for i in issues], ["missing_file", "size_mismatch", "sha256_mismatch"])

    def test_worker_denies_external_connections_and_dns_but_allows_loopback(self):
        for address in (("example.com", 443), ("192.168.1.2", 80), ("8.8.8.8", 53)):
            with self.assertRaises(PermissionError):
                block_external_network("socket.connect", (None, address))
        with self.assertRaises(PermissionError):
            block_external_network("socket.getaddrinfo", ("example.com", 443))
        block_external_network("socket.connect", (None, ("127.0.0.1", 5173)))
        block_external_network("socket.getaddrinfo", ("localhost", 5173))

    def invoke_fake(self, output, *, mutate=None, attachment_errors=False, fail=False, code_changed=False):
        def worker(request_path, _log, _timeout):
            request = json.loads(request_path.read_text())
            checks = {
                "auditFacts": {},
                "calculations": {},
                "bills": {"coverage": {"bills": 0, "lineRows": 0, "pdf": 0, "pdfMode": "3"}},
                "http": {"requests": 1},
                "consistency": {"summary": {"warnings": 0}},
                "historicalFindings": {},
            }
            result = {"completed": not fail, "checks": checks}
            if request["case"] == "restored":
                items = request["references"]["local"]
                result["attachments"] = {
                    "downloads": [],
                    "storageOnly": [],
                    "missing": items if not attachment_errors else [],
                    "errors": [{**i, "error": "download failed"} for i in items] if attachment_errors else [],
                }
                if mutate:
                    mutate()
            write_json(request["result"], result)
            return 1 if fail else 0

        with (
            patch.object(runner, "run_worker", side_effect=worker),
            patch.object(runner, "validate_checks"),
            patch.object(runner, "code_inventory", side_effect=[{}, {"changed": "checksum"} if code_changed else {}]),
            patch.object(runner.subprocess, "check_output", return_value="revision\n"),
        ):
            return runner.drill(self.database, self.files, output, self.code)

    def test_parent_actually_backs_up_and_restores_from_bundle_without_changing_inputs(self):
        before = fingerprint(self.database), inventory(self.files)
        report = self.invoke_fake(self.root / "run")
        self.assertEqual(report["status"], "passed")
        self.assertTrue(report["completed"] and report["bundleVerified"])
        self.assertTrue(report["databaseUnchanged"] and report["filesUnchanged"])
        self.assertEqual((fingerprint(self.database), inventory(self.files)), before)
        bundle, restored = self.root / "run/bundle", self.root / "run/restored/runtime"
        self.assertEqual(file_fact(bundle / "database/cageledger.sqlite"), file_fact(self.database))
        self.assertEqual(inventory(restored / "files"), inventory(self.files))

    def test_failed_or_incomplete_workers_leave_evidence_and_never_pass(self):
        report = self.invoke_fake(self.root / "failed", fail=True)
        self.assertEqual(report["status"], "incomplete")
        self.assertFalse(report["completed"])
        self.assertTrue((self.root / "failed/report.md").is_file())
        self.assertEqual(json.loads((self.root / "failed/report.json").read_text())["status"], "incomplete")

    def test_input_changes_during_run_invalidate_success(self):
        def mutate():
            (self.files / "new").write_text("changed")

        report = self.invoke_fake(self.root / "changed", mutate=mutate)
        self.assertEqual(report["status"], "input_changed")
        self.assertFalse(report["filesUnchanged"])

    def test_code_changes_during_run_invalidate_success(self):
        report = self.invoke_fake(self.root / "code-changed", code_changed=True)
        self.assertEqual(report["status"], "code_changed")
        self.assertFalse(report["codeUnchanged"])

    def test_missing_and_http_failed_assets_cannot_pass_parent_acceptance(self):
        with closing(sqlite3.connect(self.database)) as conn:
            conn.execute("CREATE TABLE quarantine_attachments(id TEXT,payload TEXT)")
            conn.execute(
                "INSERT INTO quarantine_attachments VALUES('missing',?)", (json.dumps({"storageName": "missing.png"}),)
            )
            conn.commit()
        report = self.invoke_fake(self.root / "missing")
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["referenceIssues"][0]["reason"], "missing_file")
        report = self.invoke_fake(self.root / "download-failed", attachment_errors=True)
        self.assertEqual(report["status"], "failed")
        self.assertIn("download failed", (self.root / "download-failed/report.md").read_text())

    def test_bundle_corruption_prevents_restore_even_if_source_is_complete(self):
        real_copy = copy_tree

        def corrupt(source, target, manifest):
            real_copy(source, target, manifest)
            if Path(target).name == "files" and "bundle" in Path(target).parts:
                (Path(target) / "quarantine/original.tif").write_bytes(b"corrupted")

        with patch.object(runner, "copy_tree", side_effect=corrupt):
            report = self.invoke_fake(self.root / "bundle-corrupt")
        self.assertEqual(report["status"], "incomplete")
        self.assertFalse(report["completed"])
        self.assertIn("清单不一致", report["error"])
        self.assertTrue(report["databaseUnchanged"] and report["filesUnchanged"])

    def test_existing_output_and_input_overlap_rejected_without_modifying_sentinel(self):
        sentinel = self.root / "existing"
        sentinel.mkdir()
        (sentinel / "keep").write_text("keep")
        for output in (sentinel, self.files / "new", self.files, self.code / "new", self.database.parent):
            with self.subTest(output=output), self.assertRaises(ValueError):
                runner.drill(self.database, self.files, output, self.code)
        self.assertEqual((sentinel / "keep").read_text(), "keep")

    def test_unmerged_database_companions_are_rejected(self):
        for suffix in ("-wal", "-journal"):
            sidecar = Path(str(self.database) + suffix)
            sidecar.write_bytes(b"unmerged")
            with self.assertRaisesRegex(ValueError, "不能忽略"):
                runner.drill(self.database, self.files, self.root / "rejected", self.code)
            self.assertFalse((self.root / "rejected").exists())
            self.assertEqual(sidecar.read_bytes(), b"unmerged")
            sidecar.unlink()

    def test_timeout_terminates_worker_process_group_and_preserves_log(self):
        request = self.root / "request.json"
        write_json(
            request,
            {
                "runtime": str(self.root / "private"),
                "database": str(self.root / "private/db.sqlite"),
                "code": str(self.code),
            },
        )
        process = unittest.mock.Mock(pid=123)
        process.wait.side_effect = [subprocess.TimeoutExpired("worker", 1), 0]
        process.poll.return_value = None
        with (
            patch.object(runner.subprocess, "Popen", return_value=process) as spawn,
            patch.object(runner.os, "killpg") as kill,
        ):
            with self.assertRaises(subprocess.TimeoutExpired):
                runner.run_worker(request, self.root / "worker.log", 1)
        kill.assert_called_once_with(123, runner.signal.SIGTERM)
        self.assertTrue(spawn.call_args.kwargs["start_new_session"])
        env = spawn.call_args.kwargs["env"]
        self.assertEqual(env["CAGELEDGER_GITEA_TOKEN"], "")
        self.assertEqual(
            env["CAGELEDGER_ANIMAL_INSPECTION_IMAGES"],
            str(self.root / "private/files/animal-inspections/reference-images"),
        )

    def test_manifest_facts_and_original_database_rows_match_restored_copy(self):
        with closing(immutable_connection(self.database)) as conn:
            scope = source_scope(conn)
        self.invoke_fake(self.root / "evidence")
        manifest = json.loads((self.root / "evidence/bundle/manifest.json").read_text())
        self.assertEqual(manifest["database"], file_fact(self.database))
        with closing(immutable_connection(self.root / "evidence/restored/runtime/database/cageledger.sqlite")) as conn:
            self.assertEqual(source_scope(conn), scope)


if __name__ == "__main__":
    unittest.main()
