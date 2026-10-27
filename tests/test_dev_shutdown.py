import json
import shutil
import subprocess
import unittest
from pathlib import Path


class DevShutdownTests(unittest.TestCase):
    def test_generated_data_survives_until_all_owned_children_acknowledge_exit(self):
        root = Path(__file__).resolve().parent.parent
        result = subprocess.run(
            [shutil.which("node"), str(root / "tests/fixtures/dev-shutdown.mjs")],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(json.loads(result.stdout)["passed"], 5)
