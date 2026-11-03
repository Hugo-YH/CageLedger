import copy
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import release_pipeline as rp
import release_runtime as rt
import release_verify_delivery as delivery
import release_verify_offline as offline


def report(engine="chromium", ids=("a", "b", "c"), executed=True, shard=None):
    return {
        "config": {
            "workers": 1,
            "fullyParallel": False,
            "shard": shard,
            "projects": [{"name": engine, "retries": 0, "repeatEach": 1}],
        },
        "errors": [],
        "suites": [
            {
                "specs": [
                    {
                        "id": key,
                        "ok": True,
                        "tests": [
                            {
                                "projectName": engine,
                                "expectedStatus": "passed",
                                "status": "expected",
                                "results": [{"status": "passed", "retry": 0}] if executed else [],
                            }
                        ],
                    }
                    for key in ids
                ]
            }
        ],
        "stats": {"unexpected": 0, "flaky": 0, "skipped": 0, "expected": len(ids)},
    }


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.journal = rt.Journal(self.root / "state", {"version": "1.2.3"})
        self.output = self.root / "artifact"
        self.output.write_text("original")

    def test_only_completed_matching_intact_evidence_reuses(self):
        self.journal.begin("check", "input")
        self.assertFalse(self.journal.reusable("check", "input"))
        self.journal.end("check", "passed", [self.output])
        self.assertTrue(self.journal.reusable("check", "input"))
        self.assertFalse(self.journal.reusable("check", "other-source-or-runtime"))
        self.output.write_text("tampered")
        self.assertFalse(self.journal.reusable("check", "input"))
        self.output.unlink()
        self.assertFalse(self.journal.reusable("check", "input"))

    def test_interrupted_attempt_retained_and_retried_in_new_directory(self):
        first = self.journal.begin("build", "one")
        restarted = rt.Journal(self.journal.directory, {"version": "1.2.3"})
        self.assertFalse(restarted.reusable("build", "one"))
        second = restarted.begin("build", "one")
        self.assertNotEqual(first, second)
        self.assertEqual(restarted.data["history"][0]["status"], "running")

    def test_failed_and_empty_evidence_not_reusable(self):
        self.journal.begin("browser", "one")
        self.journal.end("browser", "failed", [self.output])
        self.assertFalse(self.journal.reusable("browser", "one"))
        self.journal.end("browser", "passed")
        self.assertFalse(self.journal.reusable("browser", "one"))

    def test_wrong_release_state_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "another checkout/version"):
            rt.Journal(self.journal.directory, {"version": "1.2.4"})

    def test_atomic_save_failure_preserves_previous_state(self):
        before = self.journal.path.read_bytes()
        with patch.object(rp.os, "replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.journal.begin("fail", "one")
        self.assertEqual(self.journal.path.read_bytes(), before)

    def test_added_artifact_file_invalidates_directory_hash(self):
        directory = self.root / "web-dist"
        directory.mkdir()
        (directory / "index.html").write_text("app")
        self.journal.begin("build", "one")
        self.journal.end("build", "passed", [directory])
        (directory / "unexpected.js").write_text("unexpected")
        self.assertFalse(self.journal.reusable("build", "one"))

    def test_source_fingerprint_covers_uncommitted_and_untracked(self):
        repo = self.root / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        source = repo / "app.py"
        source.write_text("one")
        first = rt.source_fingerprint(repo)
        source.write_text("two")
        self.assertNotEqual(first, rt.source_fingerprint(repo))
        source.write_text("one")
        self.assertEqual(first, rt.source_fingerprint(repo))
        (repo / "new.py").write_text("extra")
        self.assertNotEqual(first, rt.source_fingerprint(repo))

    def test_lock_excludes_other_worktrees_and_releases_after_exit(self):
        subprocess.run(["git", "init", "-q", str(self.root / "repo")], check=True)
        with rt.release_lock(self.root / "repo"):
            with self.assertRaisesRegex(RuntimeError, "Another managed release"):
                with rt.release_lock(self.root / "repo"):
                    self.fail("second lock acquired")
        with rt.release_lock(self.root / "repo"):
            pass


class BrowserReportTests(unittest.TestCase):
    def test_valid_catalog_and_report(self):
        self.assertEqual(rt.cases(report(), "chromium", True), rt.cases(report(executed=False), "chromium", False))

    def test_rejects_failures_skips_flakes_retries_and_incomplete_results(self):
        variants = []
        for field in ("unexpected", "flaky", "skipped"):
            data = report()
            data["stats"][field] = 1
            variants.append(data)
        for status in ("failed", "skipped", "timedOut", "interrupted"):
            data = report()
            data["suites"][0]["specs"][0]["tests"][0]["results"][0]["status"] = status
            variants.append(data)
        data = report()
        data["suites"][0]["specs"][0]["tests"][0]["results"] *= 2
        variants.append(data)
        data = report()
        data["errors"] = [{"message": "worker crashed"}]
        variants.append(data)
        variants += [report(ids=()), report(ids=("a", "a")), report(executed=False)]
        for data in variants:
            with self.subTest(data=data), self.assertRaises(RuntimeError):
                rt.cases(data, "chromium", True)

    def test_wrong_engine_workers_retry_settings_rejected(self):
        variants = [report("firefox")]
        data = report()
        data["config"]["workers"] = 2
        variants.append(data)
        data = report()
        data["config"]["projects"][0]["retries"] = 1
        variants.append(data)
        for data in variants:
            with self.assertRaises(RuntimeError):
                rt.cases(data, "chromium", True)

    def test_isolation_removes_inherited_data_credentials_and_browser_overrides(self):
        with patch.dict(
            os.environ,
            {
                "CAGELEDGER_DB": "/production.sqlite",
                "CAGELEDGER_DATA_ROOT": "/production",
                "DEEPSEEK_API_KEY": "secret",
                "PLAYWRIGHT_TEST_BASE_URL": "https://production",
            },
        ):
            env = rt.isolation_environment()
        self.assertNotIn("CAGELEDGER_DB", env)
        self.assertNotIn("PLAYWRIGHT_TEST_BASE_URL", env)
        self.assertEqual(env["CAGELEDGER_EPHEMERAL_DB"], "1")
        self.assertEqual(env["CAGELEDGER_E2E_REUSE"], "0")
        self.assertEqual(env["DEEPSEEK_API_KEY"], "")


class PipelineSimulationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        guard = Mock()
        guard.sample = {"free_percent": 55, "load1": 2, "swap_mib": 100}
        guard.policy = SimpleNamespace(cpus=10, baseline_swap=100)
        self.pipeline = rp.Pipeline(self.root, "1.2.3", self.root / "evidence", guard)
        self.pipeline.fingerprint = Mock(return_value="source-runtime")
        self.pipeline.verify_runtime = Mock()
        self.active = 0
        self.maximum = 0
        self.calls = []
        self.mutex = threading.Lock()
        self.fail_webkit = False
        self.interrupt_name = None
        self.pipeline.runner.run = self.fake_run

    def fake_run(self, args, output, env=None, probe=None):
        if "--shard=1/3" in args:
            name, ids, shard = "chromium-1", ("a",), {"current": 1, "total": 3}
        elif "--shard=2/3" in args:
            name, ids, shard = "chromium-2", ("b",), {"current": 2, "total": 3}
        elif "--shard=3/3" in args:
            name, ids, shard = "chromium-3", ("c",), {"current": 3, "total": 3}
        else:
            name, ids, shard = env["CAGELEDGER_COMPAT_BROWSER"], ("a", "b", "c"), None
        with self.mutex:
            self.active += 1
            self.maximum = max(self.maximum, self.active)
            self.calls.append(name)
        try:
            if name == self.interrupt_name:
                raise RuntimeError("memory/swap resource guard")
            time.sleep(0.02 if name == "chromium-1" else 0.04)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text("simulation")
            engine = "chromium" if shard else name
            target = output.parent if shard else output.parent / engine
            target.mkdir(exist_ok=True)
            data = report(engine, ids, shard=shard)
            if self.fail_webkit and name == "webkit":
                data["stats"]["unexpected"] = 1
            (target / "results.json").write_text(json.dumps(data))
        finally:
            with self.mutex:
                self.active -= 1

    def catalogs(self, _args, _cwd, env=None, **_kwargs):
        return json.dumps(report(env["CAGELEDGER_COMPAT_BROWSER"], executed=False))

    def probe(self, port, receipt):
        receipt.update(database=f"/tmp/cageledger-e2e-{port}/cageledger.sqlite", port=port, owned_listener=True)
        return None

    def run_browsers(self):
        with (
            patch.object(rp, "command", side_effect=self.catalogs),
            patch.object(rp, "ports_available"),
            patch.object(rp, "database_probe", side_effect=self.probe),
        ):
            self.pipeline.browsers()

    def test_two_slots_complete_exact_coverage_then_reuse_all(self):
        self.pipeline.browser_slots = 2
        self.run_browsers()
        self.assertEqual(self.maximum, 2)
        self.assertEqual(len(self.calls), 5)
        self.assertLess(self.calls.index("firefox"), self.calls.index("webkit"))
        self.run_browsers()
        self.assertEqual(len(self.calls), 5)

    def test_default_single_slot_preserves_five_independent_databases(self):
        self.run_browsers()
        self.assertEqual(self.maximum, 1)
        self.assertEqual(self.calls, ["chromium-1", "chromium-2", "chromium-3", "firefox", "webkit"])
        databases = [v["health"]["database"] for v in self.pipeline.journal.data["stages"].values()]
        self.assertEqual(len(set(databases)), 5)

    def test_slot_configuration_change_invalidates_browser_receipts(self):
        self.run_browsers()
        self.calls.clear()
        self.pipeline.browser_slots = 2
        self.run_browsers()
        self.assertEqual(len(self.calls), 5)

    def test_resource_budget_reduces_requested_two_slots(self):
        self.pipeline.browser_slots = 2
        for sample in ({"free_percent": 44}, {"load1": 11}, {"swap_mib": 357}):
            with self.subTest(sample=sample):
                self.pipeline.runner.guard.sample = {"free_percent": 55, "load1": 2, "swap_mib": 100, **sample}
                self.assertEqual(self.pipeline.browser_capacity(), 1)
        self.run_browsers()
        self.assertEqual(self.maximum, 1)

    def test_runtime_guard_failure_stops_scheduling_without_success(self):
        self.pipeline.runner.healthy = Mock(side_effect=RuntimeError("memory/swap resource guard"))
        with self.assertRaisesRegex(RuntimeError, "memory/swap"):
            self.run_browsers()
        self.assertEqual(self.calls, [])
        self.assertNotIn("browser_input", self.pipeline.journal.data)

    def test_interrupted_single_slot_resumes_only_unfinished_groups(self):
        self.interrupt_name = "chromium-3"
        with self.assertRaisesRegex(RuntimeError, "memory/swap"):
            self.run_browsers()
        self.assertEqual(self.calls, ["chromium-1", "chromium-2", "chromium-3"])
        self.interrupt_name = None
        self.calls.clear()
        self.run_browsers()
        self.assertEqual(self.calls, ["chromium-3", "firefox", "webkit"])

    def test_budget_reduction_is_latched_for_remainder_of_run(self):
        self.pipeline.browser_slots = 2
        self.pipeline.browser_capacity = Mock(side_effect=[1, 2, 2, 2, 2, 2])
        self.run_browsers()
        self.assertEqual(self.maximum, 1)

    def test_changed_converter_runtime_blocks_before_reusing_receipts(self):
        self.run_browsers()
        self.calls.clear()
        self.pipeline.verify_runtime.side_effect = RuntimeError("converter runtime changed")
        with self.assertRaisesRegex(RuntimeError, "converter runtime changed"):
            self.run_browsers()
        self.assertEqual(self.calls, [])

    def test_invalid_concurrency_rejected(self):
        for value in (0, 3, True, "1"):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                rp.Pipeline(self.root, "1.2.3", self.root / "invalid", Mock(), value)

    def test_webkit_failure_keeps_firefox_and_all_chromium(self):
        self.fail_webkit = True
        with self.assertRaises(RuntimeError):
            self.run_browsers()
        self.fail_webkit = False
        self.calls.clear()
        self.run_browsers()
        self.assertEqual(self.calls, ["webkit"])
        self.assertTrue(self.pipeline.journal.data["history"])

    def test_runtime_or_source_change_invalidates_every_browser(self):
        self.run_browsers()
        self.calls.clear()
        self.pipeline.fingerprint.return_value = "changed-runtime"
        self.run_browsers()
        self.assertEqual(len(self.calls), 5)

    def test_tampered_report_reruns_only_affected_engine(self):
        self.run_browsers()
        entry = self.pipeline.journal.data["stages"]["firefox"]
        Path(entry["report"]).write_text("{}")
        self.calls.clear()
        self.run_browsers()
        self.assertEqual(self.calls, ["firefox"])

    def test_uncertain_mutation_not_replayed(self):
        self.pipeline.runner.run = Mock()
        self.pipeline.journal.begin("upload", "input", mutation=True)
        with self.assertRaisesRegex(RuntimeError, "unknown/conflicting"):
            self.pipeline.mutation("upload", ["upload"], lambda _previous: "unknown")
        self.pipeline.runner.run.assert_not_called()

    def test_existing_matching_remote_skips_mutation(self):
        self.pipeline.runner.run = Mock()
        self.pipeline.mutation("push", ["git", "push"], lambda _previous: "present")
        self.pipeline.runner.run.assert_not_called()

    def test_failed_mutation_records_unknown_before_resume(self):
        self.pipeline.runner.run = Mock(side_effect=RuntimeError("connection lost"))
        with self.assertRaisesRegex(RuntimeError, "connection lost"):
            self.pipeline.mutation("push", ["git", "push"], lambda _previous: "absent")
        self.assertEqual(self.pipeline.journal.data["stages"]["push"]["status"], "unknown")
        self.pipeline.runner.run.reset_mock()
        self.pipeline.mutation("push", ["git", "push"], lambda _previous: "present")
        self.pipeline.runner.run.assert_not_called()

    def test_failed_or_changed_foundation_never_generates_success_receipt(self):
        self.pipeline.runner.run = Mock(side_effect=RuntimeError("test failed"))
        with self.assertRaises(RuntimeError):
            self.pipeline.stage("check", ["npm", "run", "check"])
        self.assertEqual(self.pipeline.journal.data["stages"]["check"]["status"], "failed")

    def test_artifact_change_invalidates_downstream_gate(self):
        artifact = self.root / "package.tar.gz"
        artifact.write_text("one")
        calls = []

        def run(args, output, **kwargs):
            calls.append(args)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text("passed")

        self.pipeline.runner.run = run
        self.pipeline.stage("smoke", ["smoke"], inputs=[artifact])
        self.pipeline.stage("smoke", ["smoke"], inputs=[artifact])
        self.assertEqual(len(calls), 1)
        artifact.write_text("two")
        self.pipeline.stage("smoke", ["smoke"], inputs=[artifact])
        self.assertEqual(len(calls), 2)

    def test_publish_order_and_partial_remote_ref_resume(self):
        self.pipeline.branch = "main"
        self.pipeline.preflight_remote = "new"
        self.pipeline.journal.data.update(
            commit="new", image_manifest=rt.hashed({"version": "image"}), latest_baseline="old"
        )
        (self.root / "package.json").write_text(json.dumps({"version": "1.2.3", "build": 1}))
        log = self.root / "image.log"
        log.write_text("passed")
        self.pipeline.journal.begin("images", "source-runtime", mutation=True)
        self.pipeline.journal.end("images", "passed", [log])
        remote = {"refs/heads/main": "new", "refs/tags/v1.2.3": None}
        operations = []
        release = {}
        latest = {"value": "old"}
        client = Mock()

        def read_release(path):
            if not release:
                raise delivery.ReleaseHTTPError(404, "absent")
            return {"id": 1}

        client.json.side_effect = read_release

        def command(args, *unused, **kwargs):
            if args[:4] == ["docker", "buildx", "imagetools", "inspect"]:
                return json.dumps({"version": "image"})
            if args[:2] == ["git", "rev-parse"]:
                return "tag-object"
            return ""

        def run(args, output, **kwargs):
            operations.append(args[0] if args[0] != "bash" else args[1])
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text("passed")
            if args[:2] == ["git", "push"]:
                remote["refs/tags/v1.2.3"] = "tag-object"
            elif args[0] == "bash":
                release["done"] = True
            else:
                latest["value"] = self.pipeline.journal.data["image_manifest"]

        def stage(name, *args, **kwargs):
            operations.append(name.split("-")[0])

        self.pipeline.runner.run = run
        self.pipeline.stage = stage
        self.pipeline._verify_uploaded = Mock(return_value=True)
        with (
            patch.object(delivery, "Client", return_value=client),
            patch.object(delivery, "gitea_authorization", return_value="test"),
            patch.object(rp, "remote_ref", side_effect=lambda _repo, ref: remote[ref]),
            patch.object(rp, "command", side_effect=command),
            patch.object(
                rp,
                "manifest_identity",
                side_effect=lambda _repo, image: latest["value"]
                if image.endswith(":latest")
                else self.pipeline.journal.data["image_manifest"],
            ),
        ):
            self.pipeline.publish()
        self.assertEqual(
            operations,
            ["git", "scripts/upload_release_package_local.sh", "wiki", "delivery", "offline", "remote", "docker"],
        )
        self.assertEqual(remote["refs/heads/main"], "new")
        self.assertEqual(latest["value"], self.pipeline.journal.data["image_manifest"])

    def test_release_readback_creates_notes_directory_and_checks_asset_bytes(self):
        import io

        archive = self.root / "package.tar.gz"
        archive.write_bytes(b"verified package")
        client = Mock()
        client.authorization = "test"
        client.json.return_value = {
            "draft": False,
            "tag_name": "v1.2.3",
            "body": "notes",
            "assets": [{"name": archive.name, "browser_download_url": delivery.BASE + "/asset"}],
        }
        client.opener.open.return_value = io.BytesIO(b"verified package")

        def generate(args, *unused, **kwargs):
            directory = Path(args[args.index("--output-dir") + 1])
            self.assertTrue(directory.is_dir())
            (directory / "release-create.json").write_text(json.dumps({"body": "notes"}))
            return ""

        with patch.object(rp, "command", side_effect=generate):
            self.assertTrue(self.pipeline._verify_uploaded(client, archive))
        client.opener.open.return_value = io.BytesIO(b"wrong package")
        with patch.object(rp, "command", side_effect=generate), self.assertRaisesRegex(RuntimeError, "SHA mismatch"):
            self.pipeline._verify_uploaded(client, archive)

    def test_partial_image_publication_stops_before_any_mutation(self):
        self.pipeline.branch = "main"
        self.pipeline.preflight_remote = "new"
        self.pipeline.journal.data["commit"] = "new"
        self.pipeline.journal.begin("images", "source-runtime", mutation=True)
        self.pipeline.runner.run = Mock()
        with (
            patch.object(delivery, "Client"),
            patch.object(delivery, "gitea_authorization", return_value="test"),
            patch.object(rp, "remote_ref", return_value="new"),
        ):
            with self.assertRaisesRegex(RuntimeError, "Partial image"):
                self.pipeline.publish()
        self.pipeline.runner.run.assert_not_called()


class RemoteAndProcessSafetyTests(unittest.TestCase):
    def test_official_http_and_existing_ssh_origin_are_supported(self):
        for url in (
            "http://ddns.cellnucle.us:3333/hugo/cageledger.git",
            "git@git.cellnucle.us:hugo/cageledger.git",
            "ssh://git@git.cellnucle.us/hugo/cageledger.git",
        ):
            self.assertTrue(rt.official_origin(url))
        for url in ("git@git.cellnucle.us:other/cageledger.git", "git@foreign.example:hugo/cageledger.git"):
            self.assertFalse(rt.official_origin(url))

    def test_git_auth_failure_is_not_absence(self):
        for code in (1, 128):
            with patch.object(rp.subprocess, "run", return_value=SimpleNamespace(returncode=code)):
                with self.assertRaisesRegex(RuntimeError, "unknown"):
                    rt.remote_ref(Path("/tmp"), "refs/tags/v1.2.3")
        with patch.object(rp.subprocess, "run", return_value=SimpleNamespace(returncode=2)):
            self.assertIsNone(rt.remote_ref(Path("/tmp"), "refs/tags/v1.2.3"))

    def test_conflicting_remote_tag_is_not_overwritten(self):
        self.assertFalse(rt.reconcile_ref(None, "expected"))
        self.assertTrue(rt.reconcile_ref("expected", "expected"))
        with self.assertRaises(RuntimeError):
            rt.reconcile_ref("foreign", "expected")

    def test_registry_manifest_success_and_exact_missing_responses(self):
        image = "registry.example/repo:1.2.3"
        manifest = {"schemaVersion": 2, "manifests": [{"digest": "sha256:" + "a" * 64}]}
        success = SimpleNamespace(returncode=0, stdout=json.dumps(manifest), stderr="")
        self.assertEqual(rt.manifest_result(success, image), rt.hashed(manifest))
        for text in (f"ERROR: {image}: not found", f"ERROR: {image}: manifest unknown"):
            with patch.object(
                rp.subprocess, "run", return_value=SimpleNamespace(returncode=1, stdout="", stderr=text + "\n")
            ):
                self.assertIsNone(rt.manifest_identity(Path("/tmp"), image))

    def test_registry_refusals_timeouts_and_ambiguous_responses_stay_unknown(self):
        image = "registry.example/repo:1.2.3"
        errors = [
            "unauthorized",
            "connection timed out",
            "server error",
            "manifest unknown",
            "ERROR: another/repo:1.2.3: not found",
            f"ERROR: {image}: not found\nunauthorized",
            f"ERROR: {image}: failed to authorize: not found",
            "404 page not found",
            "",
        ]
        for error in errors:
            with self.subTest(error=error), self.assertRaises(RuntimeError):
                rt.manifest_result(SimpleNamespace(returncode=1, stdout="", stderr=error), image)
        for result in [
            SimpleNamespace(returncode=127, stdout="", stderr=f"ERROR: {image}: not found"),
            SimpleNamespace(returncode=1, stdout="unexpected", stderr=f"ERROR: {image}: not found"),
            SimpleNamespace(returncode=0, stdout="{}", stderr=""),
            SimpleNamespace(returncode=0, stdout="not json", stderr=""),
            SimpleNamespace(returncode=0, stdout='{"schemaVersion":2,"manifests":[]}', stderr=""),
        ]:
            with self.assertRaises(RuntimeError):
                rt.manifest_result(result, image)
        with patch.object(rp.subprocess, "run", side_effect=subprocess.TimeoutExpired("docker", 60)):
            with self.assertRaises(subprocess.TimeoutExpired):
                rt.manifest_identity(Path("/tmp"), image)

    def test_chinese_release_path_uses_nul_delimiters(self):
        with patch.object(rt, "command", return_value="wiki/更新日志.md\0package.json\0") as command:
            self.assertEqual(rt.changed_paths(Path("/tmp")), {"wiki/更新日志.md", "package.json"})
            self.assertIn("-z", command.call_args.args[0])

    def test_detached_descendants_are_owned_but_foreign_processes_are_not(self):
        rows = {
            70001: {"parent": 1, "group": 70001, "identity": "leader"},
            70002: {"parent": 70001, "group": 70002, "identity": "child"},
            70003: {"parent": 1, "group": 70003, "identity": "foreign"},
        }
        with patch.object(rt, "process_snapshot", return_value=rows), patch.object(rp.os, "killpg") as kill:
            owner = rt.OwnedProcesses(SimpleNamespace(pid=70001, poll=lambda: None))
            self.assertEqual(owner.live, {70001, 70002})
            owner.signal(15)
            self.assertEqual({call.args[0] for call in kill.call_args_list}, {70001, 70002})

    def test_recycled_and_unknown_group_members_never_signalled(self):
        rows = {70001: {"parent": 1, "group": 70001, "identity": "original"}}
        with (
            patch.object(rt, "process_snapshot", side_effect=lambda: copy.deepcopy(rows)),
            patch.object(rp.os, "killpg") as kill,
        ):
            owner = rt.OwnedProcesses(SimpleNamespace(pid=70001, poll=lambda: None))
            rows[70002] = {"parent": 1, "group": 70001, "identity": "unknown"}
            with self.assertRaisesRegex(RuntimeError, "Unknown/recycled"):
                owner.signal(15)
            kill.assert_not_called()
            rows.pop(70002)
            rows[70001]["identity"] = "recycled"
            with self.assertRaisesRegex(RuntimeError, "recycled"):
                owner.signal(15)
            kill.assert_not_called()

    def test_guard_blocks_before_process_launch(self):
        guard = SimpleNamespace(check=lambda: False, reason="new Jetsam")
        runner = rt.Runner(Path("/tmp"), guard)
        with patch.object(rp.subprocess, "Popen") as start:
            with self.assertRaisesRegex(RuntimeError, "Jetsam"):
                runner.run(["anything"], Path("/tmp/unused.log"))
            start.assert_not_called()

    def test_dual_arch_and_annotated_tag_contracts(self):
        manifest = {
            "manifests": [
                {"platform": {"os": "linux", "architecture": arch}, "digest": "sha256:" + char * 64}
                for arch, char in (("arm64", "a"), ("amd64", "b"))
            ]
        }
        self.assertEqual(set(delivery.manifest_platforms(manifest)), {"arm64", "amd64"})
        manifest["manifests"].pop()
        with self.assertRaises(RuntimeError):
            delivery.manifest_platforms(manifest)
        with self.assertRaises(RuntimeError):
            delivery.parse_remote_refs("a" * 40 + "\trefs/tags/v1.2.3", "1.2.3", "a" * 40, ["main"])

    def test_environment_template_must_be_committed_and_identical(self):
        offline.validate_public_env_template(b"PUBLIC=yes", b"PUBLIC=yes", tracked=True, committed=b"PUBLIC=yes")
        for tracked, committed in ((False, b"PUBLIC=yes"), (True, b"OTHER=yes")):
            with self.assertRaises(RuntimeError):
                offline.validate_public_env_template(b"PUBLIC=yes", b"PUBLIC=yes", tracked=tracked, committed=committed)

    def test_real_owned_process_completes_without_signalling_unrelated_processes(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "command.log"
            runner = rt.Runner(Path(directory), SimpleNamespace(check=lambda: True, reason=""))
            runner.run([sys.executable, "-c", "print('isolated command passed')"], log)
            self.assertIn("isolated command passed", log.read_text())

    def test_archive_data_and_path_escape_block_before_extraction(self):
        import io
        import tarfile

        for name in ("repo/data/private.json", "repo/.env", "repo/user.sqlite-wal", "repo/../escape"):
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode="w") as archive:
                entry = tarfile.TarInfo(name)
                archive.addfile(entry, io.BytesIO())
            buffer.seek(0)
            with tarfile.open(fileobj=buffer) as archive, self.assertRaises(RuntimeError):
                offline.archive_check(archive, Path("/tmp/repo"))

    def test_existing_shell_entry_reaches_read_only_managed_plan(self):
        result = subprocess.run(
            ["bash", "scripts/release_local.sh", "--version", "1.2.3", "--push", "--dry-run"],
            cwd=rp.ROOT,
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("delivery/offline verification → latest", result.stdout)

    def test_explicit_unsupported_node_does_not_fall_back_or_start_release(self):
        result = subprocess.run(
            ["bash", "scripts/release_local.sh", "--version", "1.2.3", "--dry-run"],
            cwd=rp.ROOT,
            env={**os.environ, "CAGELEDGER_NODE_BIN": "/usr/bin/false"},
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Node >=22.12 <23", result.stderr)

    def test_dry_run_entry_does_not_launch_network_or_build(self):
        with (
            patch.object(sys, "argv", ["release_pipeline.py", "--version", "1.2.3", "--push", "--dry-run"]),
            patch.object(rp.subprocess, "run") as run,
        ):
            rp.main()
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
