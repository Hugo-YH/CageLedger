import os
import shutil
import signal
import subprocess
import sys
import time
import unittest
from pathlib import Path


class PythonLauncherTests(unittest.TestCase):
    def command(self, *args):
        return [shutil.which("node"), "scripts/run_python.mjs", "tests/fixtures/python-launcher-child.py", *args]

    def environment(self):
        return {**os.environ, "CAGELEDGER_PYTHON_BIN": sys.executable}

    def test_launcher_forwards_one_signal_and_waits_for_delayed_child_cleanup(self):
        for name in (signal.SIGTERM, signal.SIGINT):
            with self.subTest(signal=name):
                process = subprocess.Popen(
                    self.command(),
                    cwd=Path(__file__).resolve().parent.parent,
                    env=self.environment(),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                try:
                    self.assertEqual(process.stdout.readline().strip(), "READY")
                    process.send_signal(name)
                    time.sleep(0.03)
                    self.assertIsNone(process.poll(), "launcher exited before child cleanup")
                    process.send_signal(name)
                    output, error = process.communicate(timeout=6)
                    self.assertEqual(process.returncode, 0, error)
                    self.assertEqual(output.splitlines(), [f"SIGNAL {name.name}", "CLOSED"])
                finally:
                    if process.poll() is None:
                        process.send_signal(signal.SIGTERM)
                        process.wait(timeout=6)
                    process.stdout.close()
                    process.stderr.close()

    def test_launcher_preserves_normal_child_failure_status(self):
        result = subprocess.run(
            self.command("7"),
            cwd=Path(__file__).resolve().parent.parent,
            env=self.environment(),
            capture_output=True,
            text=True,
            timeout=6,
        )
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout.strip(), "READY")
