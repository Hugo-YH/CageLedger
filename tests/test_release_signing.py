import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import release_credentials as credentials
import release_pipeline as pipeline
import release_runtime as runtime


class SigningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Release test")
        self.git("config", "user.email", "release@example.test")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "tag.gpgsign", "false")
        self.git("config", "core.hooksPath", str(self.repo / "no-hooks"))
        (self.repo / "package.json").write_text('{"version":"1.0.0"}')
        for name in runtime.RELEASE_FILES - {"package.json"}:
            file = self.repo / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("release fixture\n")
        self.git("add", ".")
        self.git("commit", "-qm", "initial")
        self.initial = self.git("rev-parse", "HEAD")

    def git(self, *args):
        result = credentials.run(["git", *args], self.repo)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def configured_key(self):
        key = self.repo.parent / "test-key"
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True)
        allowed = self.repo.parent / "allowed-signers"
        allowed.write_text("release@example.test " + key.with_suffix(".pub").read_text())
        self.git("config", "gpg.format", "ssh")
        self.git("config", "user.signingkey", str(key))
        self.git("config", "gpg.ssh.allowedSignersFile", str(allowed))
        return allowed

    def release(self, sign=False):
        (self.repo / "package.json").write_text('{"version":"1.2.3"}')
        with patch.object(pipeline, "isolation_environment", return_value={}):
            value = pipeline.Pipeline(self.repo, "1.2.3", self.repo.parent / "state", SimpleNamespace(), sign=sign)
        value.branch = "main"
        value.preflight_remote = self.initial
        value.verify_runtime = Mock()
        value.fingerprint = Mock(return_value="verified")
        value.journal.data["browser_input"] = "verified"
        return value

    def test_default_overrides_local_auto_sign_without_touching_config(self):
        self.git("config", "commit.gpgsign", "true")
        self.git("config", "tag.gpgsign", "true")
        self.git("config", "gpg.program", "/usr/bin/false")
        before = (self.repo / ".git/config").read_bytes()
        value = self.release()
        with patch.object(pipeline, "remote_ref", return_value=self.initial):
            value.commit_and_tag()
            value.commit_and_tag()  # Idempotent resume, no duplicate release commit.
        self.assertEqual(self.git("rev-list", "--count", "HEAD"), "2")
        self.assertNotIn("gpgsig", self.git("cat-file", "-p", "HEAD"))
        self.assertEqual(self.git("cat-file", "-t", "v1.2.3"), "tag")
        self.assertNotIn("SIGNATURE", self.git("cat-file", "-p", "v1.2.3"))
        self.assertEqual(before, (self.repo / ".git/config").read_bytes())

    def test_signed_probe_isolated_even_with_inherited_git_selectors(self):
        self.configured_key()
        before = runtime.tree(self.repo / ".git")
        with (
            credentials.noninteractive_credentials(),
            patch.dict(
                os.environ,
                {
                    "GIT_DIR": str(self.repo / ".git"),
                    "GIT_WORK_TREE": str(self.repo),
                    "GIT_INDEX_FILE": str(self.repo / ".git/index"),
                },
            ),
        ):
            result = credentials.verify_signing(self.repo, recover=False)
        self.assertTrue(result["tag_verified"])
        self.assertEqual(before, runtime.tree(self.repo / ".git"))

    def test_explicit_sign_does_not_require_global_auto_sign_enabled(self):
        self.configured_key()
        value = self.release(sign=True)
        with patch.object(pipeline, "remote_ref", return_value=self.initial):
            value.commit_and_tag()
        self.git("verify-commit", "HEAD")
        self.git("verify-tag", "v1.2.3")
        self.assertEqual(self.git("config", "commit.gpgsign"), "false")

    def test_bad_trust_fails_without_downgrade_or_keychain_retry(self):
        allowed = self.configured_key()
        allowed.write_text("")
        with patch.object(credentials, "recover_ssh_identity") as recover:
            with self.assertRaisesRegex(credentials.CredentialError, "验证失败"):
                credentials.verify_signing(self.repo)
        recover.assert_not_called()

    def test_recovery_is_bounded_to_one_attempt(self):
        with (
            patch.object(credentials, "signing_config", return_value={}),
            patch.object(credentials, "signing_rehearsal", return_value="sign") as probe,
            patch.object(credentials, "recover_ssh_identity", return_value=True) as recover,
        ):
            with self.assertRaises(credentials.CredentialError):
                credentials.verify_signing(self.repo)
        self.assertEqual(probe.call_count, 2)
        recover.assert_called_once()

    def test_signing_policy_frozen_after_commit_including_legacy_journal(self):
        for previous in (None, "signed"):
            journal = SimpleNamespace(data={"commit_intent": {"parent": "abc"}}, save=Mock())
            if previous:
                journal.data["signing"] = previous
            with self.assertRaises(credentials.CredentialError):
                credentials.record_signing(journal, False)
            journal.save.assert_not_called()
            credentials.record_signing(journal, True)
        journal = SimpleNamespace(data={"signing": "signed", "stages": {"check": "passed"}}, save=Mock())
        credentials.record_signing(journal, False)
        self.assertEqual(journal.data["stages"]["check"], "passed")

    def test_noninteractive_environment_restores_and_does_not_overwrite_ssh_transport(self):
        with patch.dict(os.environ, {"GIT_SSH_COMMAND": "custom-transport", "GIT_TERMINAL_PROMPT": "1"}):
            with credentials.noninteractive_credentials():
                self.assertEqual(os.environ["GIT_TERMINAL_PROMPT"], "0")
                self.assertEqual(os.environ["GIT_SSH_COMMAND"], "custom-transport")
            self.assertEqual(os.environ["GIT_TERMINAL_PROMPT"], "1")


if __name__ == "__main__":
    unittest.main()
