import json
import shutil
import subprocess
import unittest
from pathlib import Path


class ViteDataBoundaryTests(unittest.TestCase):
    def test_project_data_and_default_secrets_are_denied_without_breaking_assets_or_proxies(self):
        result = subprocess.run(
            [shutil.which("node"), "tests/fixtures/vite-data-boundary.mjs"],
            cwd=Path(__file__).resolve().parent.parent,
            capture_output=True,
            text=True,
            timeout=45,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertTrue(report["defaultsPreserved"])
        self.assertEqual(report["protectedFiles"], 16)
        self.assertEqual(report["forbiddenRequests"], 68)
        self.assertEqual(report["normalControls"], 4)
        self.assertEqual(report["proxyControls"], 2)
        self.assertFalse(report["realProjectDataRequested"])
