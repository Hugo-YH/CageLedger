import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import call, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import release_completion as completion
from release_runtime import Journal


class CompletionEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.repo = self.root / "release"
        self.repo.mkdir()
        self.source = self.root / "development"
        self.source.mkdir()
        (self.source / ".env").write_text("APP_TEST_VALUE=fixture\n")
        (self.source / "data/attachments").mkdir(parents=True)
        (self.source / "data/cageledger.sqlite3").write_bytes(b"fixture database, not a running SQLite file")
        (self.source / "data/attachments/original.png").write_bytes(b"fixture attachment")
        (self.source / "README.md").write_text("source documentation")
        self.journal = Journal(self.root / "evidence", {"version": "1.30.0", "repo": str(self.repo)})
        self.journal.data.update(signing="unsigned", commit="d" * 40)
        self.pipeline = SimpleNamespace(repo=self.repo, journal=self.journal, version="1.30.0", branch="main")
        self.command_patch = patch.object(completion, "command", return_value=str(self.source))
        self.command = self.command_patch.start()
        self.addCleanup(self.command_patch.stop)
        self.snapshot_patch = patch.object(completion, "process_snapshot", return_value={})
        self.snapshot = self.snapshot_patch.start()
        self.addCleanup(self.snapshot_patch.stop)
        self.cleanup_receipt()

    def read_summary(self):
        return json.loads((self.journal.directory / "release-summary.json").read_text())

    def finish(self, instance, completed=False, published=False):
        with patch("builtins.print"):
            instance.finish(completed, published)

    def cleanup_receipt(self, *, complete=True):
        path = self.journal.directory / "check/attempt/command-cleanup.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"identities": {"123": "original process birth"}, "complete": complete}))

    def test_snapshot_covers_environment_database_and_nested_attachments_only(self):
        files = completion.protected_files(self.source)
        self.assertEqual(set(files), {".env", "data/cageledger.sqlite3", "data/attachments/original.png"})
        self.assertTrue(all(len(digest) == 64 for digest in files.values()))
        self.assertNotIn("APP_TEST_VALUE", json.dumps(files))

    def test_modified_original_is_reported_and_not_restored(self):
        instance = completion.Completion(self.pipeline, self.source)
        attachment = self.source / "data/attachments/original.png"
        attachment.write_bytes(b"changed by another actor")
        with self.assertRaisesRegex(RuntimeError, "Protected originals changed"):
            self.finish(instance, completed=True)
        summary = self.read_summary()
        self.assertEqual(summary["original_files"]["changed"], ["data/attachments/original.png"])
        self.assertEqual(summary["status"], "finalization_incomplete")
        self.assertEqual(attachment.read_bytes(), b"changed by another actor")

    def test_new_original_file_is_reported_without_deletion(self):
        instance = completion.Completion(self.pipeline, self.source)
        new_file = self.source / "data/attachments/new.png"
        new_file.write_bytes(b"new attachment")
        with self.assertRaisesRegex(RuntimeError, "Protected originals changed"):
            self.finish(instance, completed=True)
        self.assertEqual(self.read_summary()["original_files"]["changed"], ["data/attachments/new.png"])
        self.assertTrue(new_file.exists())

    def test_deleted_original_is_detected(self):
        instance = completion.Completion(self.pipeline, self.source)
        (self.source / "data/cageledger.sqlite3").unlink()
        with self.assertRaisesRegex(RuntimeError, "Protected originals changed"):
            self.finish(instance, completed=True)
        self.assertEqual(self.read_summary()["original_files"]["changed"], ["data/cageledger.sqlite3"])
        self.assertFalse((self.source / "data/cageledger.sqlite3").exists())

    def test_resume_cannot_change_or_remove_source_checkout_identity(self):
        completion.Completion(self.pipeline, self.source)
        baseline = (self.journal.directory / "original-files-before.json").read_text()
        other = self.root / "another-source"
        other.mkdir()
        for source in (other, None):
            with self.subTest(source=source):
                with self.assertRaisesRegex(RuntimeError, "original --source-checkout"):
                    completion.Completion(self.pipeline, source)
        self.assertEqual(self.journal.data["source_checkout"], str(self.source.resolve()))
        self.assertEqual((self.journal.directory / "original-files-before.json").read_text(), baseline)

    def test_same_checkout_cannot_be_used_as_its_own_protected_source(self):
        with self.assertRaisesRegex(RuntimeError, "separate from release checkout"):
            completion.Completion(self.pipeline, self.repo)

    def test_matching_live_process_identity_prevents_success(self):
        self.cleanup_receipt()
        self.snapshot.return_value = {123: {"identity": "original process birth"}}
        evidence = completion.cleanup_evidence(self.journal.directory)
        self.assertFalse(evidence["complete"])
        self.assertEqual(evidence["processes"][0]["remaining_owned_pids"], [123])
        instance = completion.Completion(self.pipeline)
        with self.assertRaisesRegex(RuntimeError, "cleanup incomplete"):
            self.finish(instance, completed=True, published=True)
        summary = self.read_summary()
        self.assertEqual(summary["publication"], "verified")
        self.assertEqual(summary["status"], "finalization_incomplete")
        self.command.assert_not_called()

    def test_recycled_pid_is_not_misreported_as_the_owned_process(self):
        self.cleanup_receipt()
        self.snapshot.return_value = {123: {"identity": "new process birth"}, 456: {"identity": "unrelated"}}
        evidence = completion.cleanup_evidence(self.journal.directory)
        self.assertTrue(evidence["complete"])
        self.assertEqual(evidence["processes"][0]["remaining_owned_pids"], [])
        self.command.assert_not_called()

    def test_prior_cleanup_failure_recovers_only_after_owned_identities_have_exited(self):
        self.cleanup_receipt(complete=False)
        self.assertTrue(completion.cleanup_evidence(self.journal.directory)["complete"])

    def test_missing_cleanup_evidence_cannot_be_called_complete(self):
        (self.journal.directory / "check/attempt/command-cleanup.json").unlink()
        self.assertFalse(completion.cleanup_evidence(self.journal.directory)["complete"])

    def test_previous_container_cleanup_failure_is_rechecked_without_removing_anything(self):
        path = self.journal.directory / "delivery-old/arm64/container-smoke.json"
        path.parent.mkdir(parents=True)
        name = "cageledger-release-1300-arm64-123456abcdef"
        path.write_text(json.dumps({"owned_container_stopped": False, "owned_container_name": name}))
        self.command.return_value = ""
        self.assertTrue(completion.cleanup_evidence(self.journal.directory)["complete"])
        self.command.assert_called_once_with(
            ["docker", "ps", "-a", "--filter", f"name=^/{name}$", "--format", "{{.ID}}"]
        )
        self.command.return_value = "still-present"
        self.assertFalse(completion.cleanup_evidence(self.journal.directory)["complete"])

    def test_linked_file_target_change_is_detected_and_linked_directory_is_rejected(self):
        target = self.root / "linked-secret"
        target.write_text("original")
        env = self.source / ".env"
        env.unlink()
        env.symlink_to(target)
        before = completion.protected_files(self.source)
        target.write_text("updated")
        self.assertNotEqual(before, completion.protected_files(self.source))
        (self.source / "data/link").symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "symlink"):
            completion.protected_files(self.source)

    def test_beta_advances_only_after_ancestor_check_and_readback(self):
        instance = completion.Completion(self.pipeline)
        previous = "a" * 40
        revision = self.journal.data["commit"]
        self.command.reset_mock()
        with patch.object(completion, "remote_ref", side_effect=[previous, revision]):
            result = instance.synchronize()
        self.assertEqual(result["beta"], revision)
        self.assertEqual(
            self.command.call_args_list,
            [
                call(["git", "fetch", "origin", "refs/heads/beta"], self.repo),
                call(["git", "merge-base", "--is-ancestor", previous, revision], self.repo),
                call(["git", "push", "origin", f"{revision}:refs/heads/beta"], self.repo),
            ],
        )

    def test_divergent_beta_is_preserved_without_push(self):
        instance = completion.Completion(self.pipeline)

        def git(args, _repo):
            if args[:2] == ["git", "merge-base"]:
                raise RuntimeError("beta is not an ancestor")
            return ""

        self.command.side_effect = git
        with patch.object(completion, "remote_ref", return_value="a" * 40):
            with self.assertRaisesRegex(RuntimeError, "not an ancestor"):
                instance.synchronize()
        self.assertFalse(any(item.args[0][:2] == ["git", "push"] for item in self.command.call_args_list))

    def test_dirty_source_is_preserved_without_fetch_or_merge(self):
        instance = completion.Completion(self.pipeline, self.source)
        self.pipeline.branch = "rc"
        self.command.reset_mock()
        self.command.return_value = " M local-work.py"
        result = instance.synchronize()
        self.assertEqual(result["source_checkout"], "preserved_dirty_or_different_branch")
        self.command.assert_called_once_with(["git", "status", "--porcelain"], self.source)
        self.assertEqual((self.source / "README.md").read_text(), "source documentation")

    def test_clean_source_sync_refuses_origin_that_moved_after_publication(self):
        instance = completion.Completion(self.pipeline, self.source)
        self.pipeline.branch = "rc"

        def git(args, _repo):
            if args == ["git", "status", "--porcelain"]:
                return ""
            if args == ["git", "branch", "--show-current"]:
                return "rc"
            if args == ["git", "rev-parse", "FETCH_HEAD"]:
                return "e" * 40
            return ""

        self.command.side_effect = git
        with self.assertRaisesRegex(RuntimeError, "Origin moved"):
            instance.synchronize()
        self.assertFalse(any(item.args[0][:2] == ["git", "merge"] for item in self.command.call_args_list))

    def test_published_release_remains_verified_when_housekeeping_fails(self):
        instance = completion.Completion(self.pipeline, self.source)
        with patch.object(instance, "synchronize", side_effect=RuntimeError("remote housekeeping failure")):
            with self.assertRaisesRegex(RuntimeError, "housekeeping failure"):
                self.finish(instance, completed=True, published=True)
        summary = self.read_summary()
        self.assertEqual(summary["publication"], "verified")
        self.assertEqual(summary["status"], "finalization_incomplete")
        self.assertEqual(summary["production_deployment"], "not_performed")
        self.assertEqual(summary["original_files"], {"checked": 3, "changed": []})

    def test_no_source_checkout_does_not_claim_originals_were_verified(self):
        instance = completion.Completion(self.pipeline)
        self.finish(instance)
        summary = self.read_summary()
        original_files = summary.get("original_files", {})
        self.assertIn(original_files.get("checked"), (None, False, 0))
        self.assertFalse(original_files.get("verified", False))
        self.assertFalse((self.journal.directory / "original-files-before.json").exists())


if __name__ == "__main__":
    unittest.main()
