import base64
import contextlib
import json
import os
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import release_browsers as browsers
import release_cli as cli
import release_credentials as credentials
import release_pipeline as pipeline
import release_runtime as runtime


class ReleaseEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        env = patch.dict(os.environ, {"DOCKER_CONFIG": str(self.root)}, clear=True)
        env.start()
        self.addCleanup(env.stop)

    def test_login_agent_finds_gui_agent_without_loading_keys(self):
        with (
            patch.object(credentials.sys, "platform", "darwin"),
            patch.object(credentials, "agent_available", side_effect=lambda value: value == "/gui/agent"),
            patch.object(
                credentials,
                "run",
                side_effect=[
                    SimpleNamespace(returncode=0, stdout=""),
                    SimpleNamespace(returncode=0, stdout="SSH_AUTH_SOCK => /gui/agent\n"),
                ],
            ) as run,
        ):
            with credentials.noninteractive_credentials():
                self.assertEqual(os.environ["SSH_AUTH_SOCK"], "/gui/agent")
            self.assertNotIn("SSH_AUTH_SOCK", os.environ)
            self.assertTrue(all(call.args[0][0] == "launchctl" for call in run.call_args_list))

    def test_healthy_inherited_agent_is_preserved(self):
        with (
            patch.dict(os.environ, {"SSH_AUTH_SOCK": "/existing"}),
            patch.object(credentials, "agent_available", return_value=True),
            patch.object(credentials, "run") as run,
        ):
            self.assertEqual(credentials.login_agent(), "/existing")
            run.assert_not_called()

    def test_token_file_is_explicit_private_and_not_silently_ignored(self):
        token = self.root / "token"
        token.write_text("private-token\n")
        token.chmod(0o600)
        with patch.dict(os.environ, {"CAGELEDGER_GITEA_TOKEN_FILE": str(token)}):
            self.assertEqual(credentials.gitea_credentials(self.root), "token private-token")
            token.chmod(0o644)
            with self.assertRaises(credentials.CredentialError):
                credentials.gitea_credentials(self.root)

    def test_registry_fallback_only_uses_exact_official_host(self):
        encoded = base64.b64encode(b"user:private").decode()
        config = self.root / "config.json"
        with patch.object(credentials.subprocess, "run", return_value=SimpleNamespace(returncode=1, stdout="")):
            config.write_text(json.dumps({"auths": {"foreign:3333": {"auth": encoded}}}))
            with self.assertRaises(credentials.CredentialError):
                credentials.gitea_credentials(self.root)
            config.write_text(json.dumps({"auths": {"ddns.cellnucle.us:3333": {"auth": encoded}}}))
            self.assertEqual(credentials.gitea_credentials(self.root), "Basic " + encoded)

    def test_authorization_is_shared_with_children_and_restored(self):
        with patch.dict(os.environ, {"CAGELEDGER_GITEA_TOKEN": "test-only"}):
            with credentials.release_api_credentials(self.root):
                self.assertEqual(credentials.gitea_credentials(self.root), "token test-only")
                self.assertEqual(os.environ["CAGELEDGER_GITEA_AUTHORIZATION"], "token test-only")
            self.assertNotIn("CAGELEDGER_GITEA_AUTHORIZATION", os.environ)

    def test_pdf_browser_binding_survives_nested_build_receipt_environment(self):
        binary = self.root / "chromium"
        binary.write_text("test browser")
        binary.chmod(0o755)
        with patch.object(
            browsers.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=0, stdout=json.dumps({"executable": str(binary)})),
        ):
            with browsers.managed_pdf_browser(self.root):
                env = runtime.isolation_environment()
                self.assertEqual(env["CAGELEDGER_CHROMIUM_BIN"], str(binary))
                self.assertEqual(env["CAGELEDGER_RELEASE_PDF_CHROMIUM"], str(binary))
            self.assertNotIn("CAGELEDGER_RELEASE_PDF_CHROMIUM", os.environ)

    def test_missing_locked_pdf_browser_cannot_fall_back_to_system_chrome(self):
        with patch.object(
            browsers.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=0, stdout=json.dumps({"executable": str(self.root / "missing")})),
        ):
            with self.assertRaises(RuntimeError):
                browsers.pdf_browser(self.root)

    def test_catalog_requires_every_expected_unique_tag_independent_of_title(self):
        folder = self.root / "tests/e2e"
        folder.mkdir(parents=True)
        (folder / "compatibility-catalog.json").write_text(json.dumps(["@compat-a", "@compat-b"]))
        report = {
            "suites": [
                {"specs": [{"title": "renamed", "tags": ["compat-a"]}, {"title": "also renamed", "tags": ["compat-b"]}]}
            ]
        }
        pipeline.verify_compatibility_catalog(self.root, report)
        report["suites"][0]["specs"][1]["tags"] = ["compat-a"]
        with self.assertRaises(RuntimeError):
            pipeline.verify_compatibility_catalog(self.root, report)

    def test_completion_keeps_locks_and_credentials_until_converter_detached(self):
        from unittest.mock import Mock

        flags = set()

        @contextlib.contextmanager
        def lease(name, result=None):
            flags.add(name)
            try:
                yield result
            finally:
                flags.remove(name)
                if name == "converter":
                    result["detached"] = True

        repo = self.root / "repo"
        (repo / "dist").mkdir(parents=True)
        with tarfile.open(repo / "dist/CageLedger-offline-1.2.3.tar.gz", "w"):
            pass
        instance = Mock()
        instance.environment = {}
        instance.journal.data = {"stages": {"latest": {"status": "passed"}}}
        instance.fingerprint.return_value = "input"
        final = Mock(journal=instance.journal)
        converter = {"owned": True, "detached": False}

        def finish(completed, published):
            self.assertTrue(completed and published)
            self.assertEqual(flags, {"host", "repo", "transport", "api"})
            self.assertTrue(converter["detached"])

        final.finish.side_effect = finish
        with (
            patch.object(sys, "argv", ["release", "--version", "1.2.3", "--push"]),
            patch.object(cli, "ROOT", repo),
            patch.object(cli, "host_task_lock", side_effect=lambda: lease("host")),
            patch.object(cli, "release_lock", side_effect=lambda _: lease("repo")),
            patch.object(cli, "noninteractive_credentials", side_effect=lambda: lease("transport")),
            patch.object(cli, "release_api_credentials", side_effect=lambda _: lease("api")),
            patch.object(cli, "release_converter", side_effect=lambda _: lease("converter", converter)),
            patch.object(cli, "managed_pdf_browser", return_value=contextlib.nullcontext()),
            patch.object(cli, "check_browser_slots"),
            patch.object(cli, "Completion", return_value=final),
            patch("release_host_guard.HostGuard"),
            patch("release_verify_offline.archive_check", return_value={}),
            patch.object(cli, "atomic_json"),
            patch.object(cli, "digest", return_value="hash"),
            patch("builtins.print"),
        ):
            cli.main(Mock(return_value=instance))
        final.finish.assert_called_once()


if __name__ == "__main__":
    unittest.main()
