"""Real subprocess/HTTP restore checks; all source files are freshly generated fixtures."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.database_review.storage import fingerprint
from scripts.restore_drill.files import inventory
from scripts.restore_drill.runner import restore_environment

ROOT = Path(__file__).resolve().parents[1]


class RestoreDrillIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="cageledger-restore-test-")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name).resolve()
        cls.runtime = cls.root / "source"
        cls.database = cls.runtime / "database/cageledger.sqlite"
        cls.environment = restore_environment(cls.database, cls.runtime)
        # Do not inherit live application paths in either the seed or the tool.
        seeded = subprocess.run(
            [sys.executable, "-m", "tests.restore_drill_fixture"],
            cwd=ROOT,
            env=cls.environment,
            capture_output=True,
            text=True,
            timeout=90,
        )
        if seeded.returncode:
            raise AssertionError(seeded.stdout + seeded.stderr)
        cls.seed = json.loads(seeded.stdout.splitlines()[-1])
        cls.files = cls.runtime / "files"

    def run_drill(self, name):
        output = self.root / name
        process = subprocess.run(
            [
                sys.executable,
                "scripts/verify_restore.py",
                "--database",
                str(self.database),
                "--files",
                str(self.files),
                "--output",
                str(output),
            ],
            cwd=ROOT,
            env=self.environment,
            capture_output=True,
            text=True,
            timeout=180,
        )
        report = json.loads((output / "report.json").read_text())
        for case in ("control", "restored"):
            path = output / case / "result.json"
            if path.exists():
                result = json.loads(path.read_text())
                if not result["completed"]:
                    report["workerFailure"] = {"case": case, "error": result.get("error")}
        return process, report

    def test_complete_fixture_restores_business_audit_bills_and_all_download_families(self):
        before = fingerprint(self.database), inventory(self.files)
        process, report = self.run_drill("complete")
        self.assertEqual(
            process.returncode,
            0,
            process.stdout + process.stderr + str(report.get("workerFailure", report.get("attachmentChecks"))),
        )
        self.assertTrue(report["completed"] and report["bundleVerified"])
        self.assertTrue(report["databaseUnchanged"] and report["filesUnchanged"] and report["codeUnchanged"])
        self.assertEqual(report["differences"], [])
        self.assertEqual(report["referenceIssues"], [])
        self.assertEqual(report["attachmentChecks"]["errors"], [])
        kinds = {item["kind"] for item in report["attachmentChecks"]["downloads"]}
        self.assertTrue(
            {
                "workflow",
                "reimbursement",
                "inspection",
                "feedback",
                "quarantine-attachments",
                "quarantine-preview",
                "catalog-image",
            }
            <= kinds
        )
        if self.seed["wordEndpointExpected"]:
            self.assertTrue(any(item["converted"] for item in report["attachmentChecks"]["downloads"]))
        self.assertEqual(report["summary"]["exports"]["bills"], 1)
        self.assertEqual(report["summary"]["exports"]["pdf"], 1)
        self.assertEqual(self.seed["amount"], 300)
        self.assertEqual(self.seed["serviceDays"], 4)
        self.assertEqual((fingerprint(self.database), inventory(self.files)), before)
        self.assertTrue((self.root / "complete/restored/runtime/files/retained-empty").is_dir())

    def test_missing_backup_asset_is_a_nonzero_failure_with_private_evidence(self):
        # Corrupt only this class's disposable source; never the user-supplied backup.
        target = next((self.files / "feedback").glob("*.png"))
        content = target.read_bytes()
        target.unlink()
        try:
            process, report = self.run_drill("missing")
            self.assertEqual(process.returncode, 1, process.stdout + process.stderr)
            self.assertEqual(report["status"], "failed")
            self.assertTrue(
                any(
                    item["kind"] == "feedback" and item["reason"] == "missing_file"
                    for item in report["referenceIssues"]
                )
            )
            self.assertTrue(report["databaseUnchanged"] and report["filesUnchanged"])
            self.assertEqual((self.root / "missing/report.json").stat().st_mode & 0o777, 0o600)
        finally:
            target.write_bytes(content)
            os.chmod(target, 0o600)


if __name__ == "__main__":
    unittest.main()
