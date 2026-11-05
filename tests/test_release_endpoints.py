import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import gitea_git
import release_credentials as credentials
import release_endpoints as endpoints
import release_runtime as runtime


class ReleaseEndpointTests(unittest.TestCase):
    def test_default_and_https_official_remote(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(endpoints.gitea_url(), "http://ddns.cellnucle.us:3333")
            self.assertTrue(runtime.official_origin("https://git.cellnucle.us/hugo/cageledger.git"))
            self.assertFalse(runtime.official_origin("https://git.cellnucle.us.example/hugo/cageledger.git"))

    def test_https_selection_preserves_registry(self):
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "import json,release_verify_delivery as d; print(json.dumps([d.BASE,d.GIT_REMOTE,d.IMAGE]))",
            ],
            cwd=Path(__file__).resolve().parents[1] / "scripts",
            env={**os.environ, "CAGELEDGER_GITEA_URL": "https://git.cellnucle.us/"},
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertEqual(
            json.loads(result.stdout),
            [
                "https://git.cellnucle.us",
                "https://git.cellnucle.us/hugo/cageledger.git",
                "ddns.cellnucle.us:3333/hugo/cageledger",
            ],
        )

    def test_invalid_origins_do_not_echo_values(self):
        for value in (
            "https://user:private-value@git.cellnucle.us",
            "https://git.cellnucle.us/hugo/cageledger",
            "https://git.cellnucle.us?token=private-value",
            "ftp://git.cellnucle.us",
            "https://git.cellnucle.us:invalid",
        ):
            with self.subTest(value=value), patch.dict(os.environ, {"CAGELEDGER_GITEA_URL": value}):
                with self.assertRaises(ValueError) as error:
                    endpoints.gitea_url()
                self.assertNotIn("private-value", str(error.exception))

    def test_credentials_select_exact_https_host(self):
        result = SimpleNamespace(returncode=0, stdout="username=test-user\npassword=test-only\n")
        with (
            patch.dict(os.environ, {"CAGELEDGER_GITEA_URL": "https://git.cellnucle.us"}, clear=True),
            patch.object(credentials.subprocess, "run", return_value=result) as run,
        ):
            self.assertTrue(credentials.gitea_credentials(Path.cwd()).startswith("Basic "))
            self.assertEqual(
                run.call_args.kwargs["input"], "protocol=https\nhost=git.cellnucle.us\npath=hugo/cageledger\n\n"
            )

    def test_https_does_not_use_other_registry_credentials(self):
        with (
            patch.dict(os.environ, {"CAGELEDGER_GITEA_URL": "https://git.cellnucle.us"}, clear=True),
            patch.object(credentials.subprocess, "run", return_value=SimpleNamespace(returncode=1, stdout="")),
        ):
            with self.assertRaises(credentials.CredentialError):
                credentials.gitea_credentials(Path.cwd())


class GiteaGitTests(unittest.TestCase):
    def test_https_host_header_does_not_match_other_destinations(self):
        environment = gitea_git.git_environment(
            {
                **os.environ,
                "CAGELEDGER_GITEA_TOKEN": "test-only-placeholder",
                "GIT_CONFIG_COUNT": "0",
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
            }
        )
        with tempfile.TemporaryDirectory() as directory:
            for url, matches in (
                ("https://git.cellnucle.us/hugo/cageledger.git", True),
                ("http://git.cellnucle.us/hugo/cageledger.git", False),
                ("https://git.cellnucle.us.example/hugo/cageledger.git", False),
                ("https://github.com/Hugo-YH/CageLedger.git", False),
            ):
                result = subprocess.run(
                    ["git", "config", "--get-urlmatch", "http.extraHeader", url],
                    env=environment,
                    cwd=directory,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 0 if matches else 1)
                self.assertEqual(result.stdout.strip(), "Authorization: token test-only-placeholder" if matches else "")

    def test_preserves_existing_injected_configuration(self):
        original = {
            "CAGELEDGER_GITEA_TOKEN": "test-only",
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "http.https://github.com/.extraHeader",
            "GIT_CONFIG_VALUE_0": "existing-placeholder",
            "HTTPS_PROXY": "http://proxy:8080",
        }
        environment = gitea_git.git_environment(original)
        self.assertEqual(environment["GIT_CONFIG_COUNT"], "3")
        self.assertEqual(original["GIT_CONFIG_COUNT"], "1")
        for key in ("GIT_CONFIG_VALUE_0", "HTTPS_PROXY"):
            self.assertEqual(environment[key], original[key])

    def test_token_stays_out_of_arguments_and_exit_code_survives(self):
        with (
            patch.dict(os.environ, {"CAGELEDGER_GITEA_TOKEN": "test-only-placeholder"}, clear=True),
            patch.object(gitea_git.subprocess, "run", return_value=SimpleNamespace(returncode=7)) as run,
        ):
            self.assertEqual(gitea_git.main(["ls-remote", "gitea", "HEAD"]), 7)
            self.assertNotIn("test-only-placeholder", str(run.call_args.args))
        with patch.object(gitea_git.subprocess, "run") as run:
            with self.assertRaises(ValueError):
                gitea_git.main(["config", "--list"])
            run.assert_not_called()
