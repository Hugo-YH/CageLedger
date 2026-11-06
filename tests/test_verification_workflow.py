import contextlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import release_cli as cli
import release_doctor as doctor
import release_reporting as reporting
import release_runtime as runtime
import run_python_tests as python_tests
import verification_host as host
import verify_local as verify


class VerificationScopeTests(unittest.TestCase):
    def test_architecture_excludes_tool_cache_but_still_checks_project_code(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cached = root / ".codex-run/release-tools/vendor.py"
            cached.parent.mkdir(parents=True)
            cached.write_text("# bundled dependency\n" * 800)
            args = ["node", str(runtime.ROOT / "scripts/check_architecture.mjs"), "--enforce"]
            result = subprocess.run(args, cwd=root, capture_output=True, text=True, timeout=15, check=False)
            self.assertEqual(result.returncode, 0, result.stdout)
            (root / "project.py").write_text("# real project code\n" * 800)
            result = subprocess.run(args, cwd=root, capture_output=True, text=True, timeout=15, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("project.py", result.stdout)

    def test_empty_python_suite_is_failure(self):
        with patch.object(
            python_tests.unittest.defaultTestLoader, "loadTestsFromNames", return_value=unittest.TestSuite()
        ):
            with self.assertRaisesRegex(ValueError, "没有测试"):
                python_tests.run_targets(["tests.empty"])

    def test_verification_guard_selects_native_metrics(self):
        for platform, expected in (("linux", "LinuxTestGuard"), ("darwin", "HostGuard")):
            with self.subTest(platform=platform), patch.object(verify.sys, "platform", platform):
                with patch.object(verify, expected) as guard:
                    verify.verification_guard(Path("/evidence"))
                    guard.assert_called_once_with(Path("/evidence"))

    def test_pressure_admission_stops_before_test_process_start(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(verify, "ROOT", Path(directory) / "repo"),
            patch.object(verify.signal, "signal"),
            patch.object(verify, "host_task_lock", return_value=contextlib.nullcontext()),
            patch.object(verify, "verification_guard") as guard,
            patch.object(verify, "Runner") as runner,
            patch.object(sys, "argv", ["verify", "python", "tests.example"]),
        ):
            guard.return_value.check.return_value = False
            guard.return_value.reason = "memory pressure warning"
            with self.assertRaisesRegex(RuntimeError, "pressure"):
                verify.main()
            runner.return_value.run.assert_not_called()

    def test_runtime_pressure_uses_short_owned_process_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            guard = Mock(reason="memory pressure")
            runner = runtime.Runner(root, guard)
            runner.healthy = Mock(side_effect=[None, RuntimeError("memory pressure")])
            with (
                patch.object(runtime.subprocess, "Popen") as start,
                patch.object(runtime, "OwnedProcesses") as ownership,
            ):
                start.return_value.poll.return_value = None
                start.return_value.pid = 123
                ownership.return_value.identities = {}
                ownership.return_value.live = set()
                with self.assertRaisesRegex(RuntimeError, "memory pressure"):
                    runner.run(["test-command"], root / "command.log")
                ownership.return_value.close.assert_called_once_with(grace_seconds=10)

    def test_focused_commands_never_fall_back_to_full(self):
        for mode in ("unit", "related", "python"):
            with self.subTest(mode=mode), self.assertRaisesRegex(RuntimeError, "明确|提供"):
                verify.commands(mode, [])
        for mode in ("unit", "related"):
            job = verify.commands(mode, ["src/target.test.ts"])[0]
            self.assertIn("src/target.test.ts", job)
            self.assertIn("--maxWorkers=1", job)
            self.assertNotIn("--passWithNoTests", job)
        self.assertEqual(verify.commands("python", ["tests.test_example"])[0][-1], "tests.test_example")
        self.assertNotIn("discover", verify.commands("python", ["tests.test_example"])[0])

    def test_package_scope_is_serial_and_does_not_publish(self):
        self.assertEqual(
            verify.commands("package", []),
            [
                ["npm", "run", "build:shared"],
                ["npm", "run", "package:offline"],
                ["npm", "run", "package:container"],
            ],
        )
        with self.assertRaises(RuntimeError):
            verify.commands("package", ["unrequested-target"])

    def test_runtime_network_binding_is_scoped_to_container_packaging(self):
        key = "CAGELEDGER_GITEA_REGISTRY_BASIC"
        isolated = {"DEEPSEEK_API_KEY": "", "CAGELEDGER_EPHEMERAL_DB": "1"}
        with patch.dict(verify.os.environ, {key: "opaque-network-binding", "DEEPSEEK_API_KEY": "unrelated-secret"}):
            for job in verify.commands("package", []):
                result = verify.job_environment("package", job, isolated)
                self.assertEqual(key in result, job[-1] == "package:container")
                self.assertEqual(result["DEEPSEEK_API_KEY"], "")
            self.assertNotIn(key, verify.job_environment("python", ["python", "test.py"], isolated))
        self.assertNotIn(key, isolated)

    def test_full_and_browser_scope_preserve_serial_stages_single_worker(self):
        jobs = verify.commands("full", [])
        self.assertEqual(len(jobs), 4)
        self.assertEqual(jobs[0], ["npm", "run", "check:steps"])
        self.assertEqual(jobs[1], ["npm", "run", "build:shared"])
        for job in jobs[2:]:
            self.assertIn("--workers=1", job)
            self.assertIn("--retries=0", job)
        with self.assertRaises(RuntimeError):
            verify.commands("e2e", ["--workers=4"])

    def test_all_unit_with_file_remains_targeted(self):
        job = verify.commands("all-unit", ["src/one.test.ts"])[0]
        self.assertIn("src/one.test.ts", job)
        self.assertNotIn("discover", job)

    def test_dry_run_does_not_acquire_host_lock_or_launch(self):
        with (
            patch.object(sys, "argv", ["verify_local.py", "full", "--dry-run"]),
            patch.object(verify, "host_task_lock") as lock,
            patch.object(verify, "Runner") as runner,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            verify.main()
        lock.assert_not_called()
        runner.assert_not_called()

    def test_host_lock_excludes_independent_runs_and_recovers_after_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with host.host_task_lock(root):
                with self.assertRaisesRegex(RuntimeError, "已有"), host.host_task_lock(root):
                    self.fail("second run must not enter")
            with host.host_task_lock(root):
                self.assertTrue((root / "verification.lock").exists())

    def test_small_host_rejects_second_browser_before_work(self):
        with patch.object(host, "command", return_value=str(16 * 1024**3)) as run:
            host.check_browser_slots(1, Path("."))
            run.assert_not_called()
            with self.assertRaisesRegex(RuntimeError, "16GB"):
                host.check_browser_slots(2, Path("."))
        with patch.object(host, "command", return_value=str(24 * 1024**3)):
            host.check_browser_slots(2, Path("."))

    def test_read_only_status_does_not_turn_interrupted_record_into_success(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = runtime.Journal(Path(directory), {"version": "1.2.3", "repo": "/repo"})
            journal.begin("check", "source")
            before = journal.path.read_bytes()
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                reporting.show_status(directory)
            self.assertIn("需核对进程", output.getvalue())
            self.assertEqual(before, journal.path.read_bytes())

    def test_sign_dry_run_selects_policy_without_credential_access(self):
        for flag, expected in (([], "unsigned commit"), (["--sign"], "signed commit")):
            output = io.StringIO()
            with (
                patch.object(sys, "argv", ["release", "--version", "1.2.3", "--dry-run", *flag]),
                contextlib.redirect_stdout(output),
                patch.object(cli, "host_task_lock") as lock,
            ):
                cli.main(Mock())
            self.assertIn(expected, output.getvalue())
            lock.assert_not_called()

    def test_doctor_aggregates_safely_and_skips_default_signing(self):
        output = io.StringIO()
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(doctor.sys, "platform", "darwin"),
            patch.object(doctor, "execute", return_value="1"),
            patch.object(doctor, "command", return_value="22.20.0"),
            patch.object(doctor, "config", return_value="local-user"),
            patch.object(doctor, "release_converter", return_value=contextlib.nullcontext()),
            patch.object(doctor, "converter_identity"),
            patch.object(doctor, "browser_installations", side_effect=RuntimeError("secret-token")),
            patch.object(doctor, "verify_signing") as sign,
            contextlib.redirect_stdout(output),
        ):
            self.assertFalse(doctor.diagnose(Path(directory)))
        self.assertIn("[FAIL] 锁定版本的浏览器", output.getvalue())
        self.assertIn("[OK] Docker", output.getvalue())
        self.assertNotIn("secret-token", output.getvalue())
        sign.assert_not_called()

    def test_exact_playwright_binaries_required_including_headless(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / "browser"
            binary.write_text("mock")
            binary.chmod(0o700)
            entries = [{"directory": directory, "executable": str(binary)} for _ in range(5)]
            with (
                patch.object(runtime, "command", return_value=json.dumps(entries)),
                patch.object(runtime, "isolation_environment", return_value={}),
            ):
                self.assertEqual(runtime.browser_installations(Path(directory)), [Path(directory)])
            entries[1]["executable"] = str(Path(directory) / "missing-headless")
            with (
                patch.object(runtime, "command", return_value=json.dumps(entries)),
                patch.object(runtime, "isolation_environment", return_value={}),
                self.assertRaisesRegex(RuntimeError, "Browser unavailable"),
            ):
                runtime.browser_installations(Path(directory))


if __name__ == "__main__":
    unittest.main()
