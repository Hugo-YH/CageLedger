import os
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


class PythonLauncherTests(unittest.TestCase):
    def command(self, *args):
        return [shutil.which("node"), "scripts/run_python.mjs", "tests/fixtures/python-launcher-child.py", *args]

    def environment(self):
        return {**os.environ, "CAGELEDGER_PYTHON_BIN": sys.executable}

    @unittest.skipIf(os.name == "nt", "synthetic executable uses a POSIX shell")
    def test_wrong_runtime_is_rejected_before_launching_python_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            python = Path(directory) / "synthetic-python"
            python.write_text("#!/bin/sh\nprintf '3.12\\n'\n")
            python.chmod(0o700)
            result = subprocess.run(
                self.command(),
                cwd=Path(__file__).resolve().parent.parent,
                env={**os.environ, "CAGELEDGER_PYTHON_BIN": str(python)},
                capture_output=True,
                text=True,
                timeout=6,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Python 3.13", result.stderr)
            self.assertIn("3.12", result.stderr)
            self.assertNotIn("READY", result.stdout)

    @unittest.skipIf(os.name == "nt", "synthetic executable uses a POSIX shell")
    def test_shared_launcher_probes_a_verified_runtime_only_once_per_process(self):
        with tempfile.TemporaryDirectory() as directory:
            python = Path(directory) / "synthetic-python"
            other_python = Path(directory) / "synthetic-python-b"
            calls = Path(directory) / "calls"
            other_calls = Path(directory) / "other-calls"
            python.write_text("#!/bin/sh\nprintf 'probe\\n' >> " + shlex.quote(str(calls)) + "\nprintf '3.13\\n'\n")
            other_python.write_text(
                "#!/bin/sh\nprintf 'probe\\n' >> " + shlex.quote(str(other_calls)) + "\nprintf '3.13\\n'\n"
            )
            python.chmod(0o700)
            other_python.chmod(0o700)
            result = subprocess.run(
                [
                    shutil.which("node"),
                    "--input-type=module",
                    "-e",
                    "import {resolveProjectPython} from './scripts/python_runtime.mjs'; import {unlinkSync} from 'node:fs'; const a=resolveProjectPython(); process.env.CAGELEDGER_PYTHON_BIN=process.env.CAGELEDGER_TEST_PYTHON_B; resolveProjectPython(); process.env.CAGELEDGER_PYTHON_BIN=a; console.log(a===resolveProjectPython()); unlinkSync(a); try { resolveProjectPython(); } catch { console.log('unavailable'); }",
                ],
                cwd=Path(__file__).resolve().parent.parent,
                env={**os.environ, "CAGELEDGER_PYTHON_BIN": str(python), "CAGELEDGER_TEST_PYTHON_B": str(other_python)},
                capture_output=True,
                text=True,
                timeout=6,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.splitlines(), ["true", "unavailable"])
            self.assertEqual(calls.read_text().splitlines(), ["probe"])
            self.assertEqual(other_calls.read_text().splitlines(), ["probe"])

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
