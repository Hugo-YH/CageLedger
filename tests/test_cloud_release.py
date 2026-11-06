import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import cloud_package_delivery as delivery
import cloud_release as release
import gitea_release_assets as assets

from tests import test_cloud_package_delivery as fixtures

NOTES = "## 1.2.3（Build 42）\n\n### 预约识别\n\n- 保留原件，减少重复上传。"
TAG_OBJECT = "b" * 40


class OfficialMemory(fixtures.MemoryRelease):
    def __init__(self):
        super().__init__()
        self.patches = 0
        self.lose_patch_response = False

    def json(self, method, path, *, value=None):
        if method != "PATCH" or path != assets.API + "/releases/19" or value != {"draft": False}:
            raise AssertionError("Unexpected publication mutation")
        self.patches += 1
        self.value.update(draft=False, published_at="2026-11-05T23:30:00Z")
        if self.lose_patch_response:
            self.lose_patch_response = False
            raise assets.AssetError("lost PATCH response")
        return dict(self.value)


class OfficialLifecycleTests(unittest.TestCase):
    setUp = fixtures.LocalArtifacts.setUp

    def git_result(self, repo, *arguments):
        if arguments[0] == "cat-file":
            return "tag"
        if arguments[:2] == ("rev-parse", "refs/tags/v1.2.3"):
            return TAG_OBJECT
        if arguments[0] == "ls-remote" and any(arg.startswith("refs/tags/") for arg in arguments):
            return TAG_OBJECT + "\trefs/tags/v1.2.3\n" + fixtures.REVISION + "\trefs/tags/v1.2.3^{}"
        return fixtures.LocalArtifacts.git_result(self, repo, *arguments)

    def plan(self, **options):
        return delivery.prepare(self.repo, self.output, official=True, write_parts=True, **options)

    def test_image_only_filters_manifest_payloads_restore_and_official_body(self):
        plan = self.plan(include_source=False, chunk_bytes=128)
        manifest = json.loads(plan.manifest)
        self.assertEqual(plan.tag, "v1.2.3")
        self.assertFalse(manifest["source_archive_included"])
        self.assertNotIn(self.source_archive.name, plan.restore.decode())
        self.assertFalse(any("CageLedger-offline-" in item.path.name for item in plan.files()))
        self.assertEqual(
            {row["name"] for row in manifest["artifacts"]},
            {
                self.image.name,
                self.notes.name,
                "CageLedger-image-1.2.3-sha256.txt",
            },
        )
        self.assertNotIn("离线源码包", release.release_payload(plan, "owner", NOTES)["body"])
        default = fixtures.LocalArtifacts.plan(self)
        self.assertTrue(any(item.path.name == self.source_archive.name for item in default.files()))
        self.assertTrue(default.version.startswith("1.2.3-dev."))

    def test_complete_draft_publishes_once_and_resumes_without_reading_large_artifacts(self):
        plan, client, state = self.plan(include_source=False), OfficialMemory(), self.directory / "official"
        path = release.release(plan, client, state, notes=NOTES, publish=True)
        receipt = json.loads(path.read_text())
        self.assertEqual(receipt["status"], "published")
        self.assertFalse(client.value["draft"])
        self.assertFalse(client.value["prerelease"])
        self.assertTrue(client.value["body"].startswith(NOTES))
        self.assertIn(receipt["ownership"], client.value["body"])
        self.assertEqual(receipt["tag_identity"]["object"], TAG_OBJECT)
        self.assertEqual(client.patches, 1)
        for item in plan.files():
            self.assertEqual(client.body_reads.count(item.path.name), 1)
        client.body_reads.clear()
        uploaded = list(client.uploaded)
        release.release(plan, client, state, notes=NOTES, publish=True)
        self.assertEqual(client.patches, 1)
        self.assertEqual(client.uploaded, uploaded)
        self.assertEqual(client.body_reads, [delivery.PROBE_NAME, delivery.PROBE_NAME])

    def test_lost_publish_response_reconciles_owned_published_state_without_second_patch(self):
        plan, client, state = self.plan(), OfficialMemory(), self.directory / "unknown-response"
        client.lose_patch_response = True
        with self.assertRaisesRegex(assets.AssetError, "lost PATCH"):
            release.release(plan, client, state, notes=NOTES, publish=True)
        receipt = json.loads((state / "receipt.json").read_text())
        self.assertEqual(receipt["status"], "publish_pending")
        self.assertFalse(receipt["publish_intent"]["draft"])
        client.body_reads.clear()
        release.release(plan, client, state, notes=NOTES, publish=True)
        self.assertEqual(client.patches, 1)
        self.assertEqual(client.body_reads, [delivery.PROBE_NAME, delivery.PROBE_NAME])
        self.assertEqual(json.loads((state / "receipt.json").read_text())["status"], "published")

    def test_unknown_existing_release_and_changed_notes_are_not_adopted_or_patched(self):
        plan, client, state = self.plan(), OfficialMemory(), self.directory / "unknown"
        client.value = {**release.release_payload(plan, "foreign", NOTES), "id": 19, "author": client.actor()}
        with self.assertRaisesRegex(delivery.DeliveryError, "ownership"):
            release.release(plan, client, state, notes=NOTES, publish=True)
        self.assertEqual((client.uploaded, client.patches), ([], 0))
        client = OfficialMemory()
        state = self.directory / "changed-notes"
        release.release(plan, client, state, notes=NOTES)
        original_body = client.value["body"]
        with self.assertRaises(delivery.DeliveryError):
            release.publish_verified(plan, client, state, notes=NOTES + "\n- changed")
        self.assertEqual(client.patches, 0)
        self.assertEqual(client.value["body"], original_body)

    def test_incomplete_or_conflicting_hash_receipts_cannot_publish(self):
        plan, client, state = self.plan(), OfficialMemory(), self.directory / "missing-proof"
        path = release.release(plan, client, state, notes=NOTES)
        original = json.loads(path.read_text())
        for mutation in ("status", "hash", "attachment"):
            receipt = json.loads(json.dumps(original))
            name = next(iter(receipt["files"]))
            if mutation == "status":
                receipt["status"] = "incomplete"
            elif mutation == "hash":
                receipt["files"][name]["status"] = "unknown"
            else:
                receipt["files"][name]["attachment_identity"]["id"] += 100
            path.write_text(json.dumps(receipt))
            with self.subTest(mutation=mutation), self.assertRaises(delivery.DeliveryError):
                release.publish_verified(plan, client, state, notes=NOTES)
        self.assertEqual(client.patches, 0)
        self.assertTrue(client.value["draft"])


class RealAnnotatedTagTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo, self.remote = Path(self.temporary.name) / "source", Path(self.temporary.name) / "remote.git"
        self.run_git("init", "-b", "main", str(self.repo), cwd=Path(self.temporary.name))
        self.run_git("init", "--bare", str(self.remote), cwd=Path(self.temporary.name))
        (self.repo / "package.json").write_text(json.dumps({"version": "1.2.3", "build": 42}))
        self.run_git("add", "package.json")
        self.run_git("commit", "-m", "source")
        self.run_git("tag", "-a", "v1.2.3", "-m", "release")
        self.run_git("remote", "add", "gitea", assets.ORIGIN + "/hugo/cageledger.git")
        self.run_git("push", str(self.remote), "HEAD:refs/heads/main", "refs/tags/v1.2.3")
        actual = delivery.git

        def local_transport(repo, *args):
            if args[0] == "ls-remote":
                args = tuple(str(self.remote) if value == "gitea" else value for value in args)
            return actual(repo, *args)

        self.patch = patch.object(delivery, "git", side_effect=local_transport)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def run_git(self, *args, cwd=None):
        result = subprocess.run(
            [
                "git",
                "-c",
                "user.name=Release test",
                "-c",
                "user.email=release@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "tag.gpgsign=false",
                *args,
            ],
            cwd=cwd or self.repo,
            capture_output=True,
            text=True,
            check=True,
            env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1"},
        )
        return result.stdout.strip()

    def test_real_annotated_object_and_peeled_remote_commit_must_both_match(self):
        identity = release.validate_tag(self.repo)
        self.assertNotEqual(identity["object"], identity["revision"])
        self.run_git("tag", "-f", "-a", "v1.2.3", "-m", "different annotation")
        with self.assertRaisesRegex(delivery.DeliveryError, "Remote annotated tag object"):
            release.validate_tag(self.repo)

    def test_lightweight_or_old_head_tag_is_rejected(self):
        self.run_git("tag", "-d", "v1.2.3")
        self.run_git("tag", "v1.2.3")
        with self.assertRaisesRegex(delivery.DeliveryError, "Annotated version tag"):
            release.validate_tag(self.repo, check_remote=False)
        self.run_git("tag", "-f", "-a", "v1.2.3", "-m", "annotated")
        (self.repo / "change.txt").write_text("new source")
        self.run_git("add", "change.txt")
        self.run_git("commit", "-m", "later source")
        with self.assertRaisesRegex(delivery.DeliveryError, "current HEAD"):
            release.validate_tag(self.repo, check_remote=False)


class OfficialDownloadTests(unittest.TestCase):
    def test_official_helper_restores_both_owned_draft_and_published_release_and_rejects_wrong_state(self):
        archive = b"synthetic ARM archive"
        recovery = b"restore instructions"

        def sha(body):
            return hashlib.sha256(body).hexdigest()

        manifest = json.dumps(
            {
                "source": {"revision": fixtures.REVISION},
                "platforms": ["linux/arm64"],
                "recovery": {"name": "RESTORE.txt", "size": len(recovery), "sha256": sha(recovery)},
                "artifacts": [
                    {
                        "name": "image.tar.gz",
                        "size": len(archive),
                        "sha256": sha(archive),
                        "attachments": [{"name": "image.part0001.gz", "size": len(archive), "sha256": sha(archive)}],
                    }
                ],
            }
        ).encode()
        contents = {"manifest.json": manifest, "RESTORE.txt": recovery, "image.part0001.gz": archive}

        class Response(io.BytesIO):
            status = 200

        for draft, prerelease, accepted in (
            (True, False, True),
            (False, False, True),
            (False, True, False),
            (None, False, False),
        ):
            helper = {"__name__": "official_download_test"}
            exec(
                compile(
                    assets.download_script("v1.2.3", fixtures.REVISION, "manifest.json", sha(manifest), official=True),
                    "official-download",
                    "exec",
                ),
                helper,
            )

            class Opener:
                def __init__(self, draft, prerelease):
                    self.draft, self.prerelease = draft, prerelease

                def open(self, request, timeout):
                    if "/releases/tags/" in request.full_url:
                        body = json.dumps(
                            {
                                "id": 19,
                                "tag_name": "v1.2.3",
                                "target_commitish": fixtures.REVISION,
                                "draft": self.draft,
                                "prerelease": self.prerelease,
                            }
                        ).encode()
                    elif request.full_url.endswith("/assets"):
                        body = json.dumps(
                            [
                                {
                                    "id": index,
                                    "name": name,
                                    "size": len(value),
                                    "browser_download_url": assets.ORIGIN + "/attachments/" + name,
                                }
                                for index, (name, value) in enumerate(contents.items())
                            ]
                        ).encode()
                    else:
                        body = contents[request.full_url.rsplit("/", 1)[-1]]
                    return Response(body)

            with self.subTest(draft=draft, prerelease=prerelease), tempfile.TemporaryDirectory() as directory:
                with (
                    patch.object(helper["urllib"].request, "build_opener", return_value=Opener(draft, prerelease)),
                    patch.dict(os.environ, {"CAGELEDGER_GITEA_TOKEN": "test-binding"}),
                    patch.object(sys, "argv", ["download", "--directory", directory]),
                ):
                    if accepted:
                        helper["main"]()
                        self.assertEqual((Path(directory) / "image.tar.gz").read_bytes(), archive)
                    else:
                        with self.assertRaisesRegex(RuntimeError, "Release identity"):
                            helper["main"]()
