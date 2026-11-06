import hashlib
import io
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
import cloud_package_delivery as delivery
import cloud_registry as registry
import cloud_release as release
import cloud_release_registry as release_registry
import gitea_release_assets as assets

from tests import test_cloud_package_delivery as fixtures
from tests import test_cloud_registry as registry_fixtures

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
    def setUp(self):
        fixtures.LocalArtifacts.setUp(self)
        self.registry_verification = patch.object(
            release, "verify_registry", side_effect=lambda plan: json.loads(plan.manifest)["registry"]
        ).start()

    def git_result(self, repo, *arguments):
        if arguments[0] == "cat-file":
            return "tag"
        if arguments[:2] == ("rev-parse", "refs/tags/v1.2.3"):
            return TAG_OBJECT
        if arguments[0] == "ls-remote" and any(arg.startswith("refs/tags/") for arg in arguments):
            return TAG_OBJECT + "\trefs/tags/v1.2.3\n" + fixtures.REVISION + "\trefs/tags/v1.2.3^{}"
        return fixtures.LocalArtifacts.git_result(self, repo, *arguments)

    def plan(self, **options):
        proof = {
            "status": "verified",
            "repository": release_registry.IMAGE_REPOSITORY,
            "version": "1.2.3",
            "revision": fixtures.REVISION,
            "archive_sha256": "sha256:" + delivery.sha256_file(self.image),
            **{
                key: {"digest": "sha256:" + marker * 64, "size": 100, "mediaType": kind}
                for key, marker, kind in (
                    ("manifest", "1", registry.IMAGE),
                    ("index", "2", registry.INDEX),
                    ("config", "3", registry.CONFIG),
                )
            },
        }
        options.setdefault("registry_proof", proof)
        return delivery.prepare(self.repo, self.output, official=True, write_parts=True, **options)

    def test_default_has_only_small_metadata_and_exact_package_pull_instructions(self):
        with patch.object(delivery, "split_artifact", side_effect=AssertionError("default must not split images")):
            plan = self.plan()
        manifest = json.loads(plan.manifest)
        self.assertFalse(plan.offline_image)
        self.assertFalse(manifest["source_archive_included"])
        self.assertFalse(manifest["offline_image_included"])
        self.assertEqual(manifest["artifacts"], [])
        self.assertEqual(plan.payloads, ())
        self.assertEqual({item.path.name for item in plan.files()}, {plan.manifest_path.name, delivery.PULL_NAME})
        self.assertEqual(
            set(plan.generated()),
            {plan.manifest_path, plan.directory / delivery.PULL_NAME, plan.directory / delivery.PROBE_NAME},
        )
        self.assertIn(manifest["registry"]["index"]["digest"], plan.restore.decode())
        body = release.release_payload(plan, "owner", NOTES)["body"]
        self.assertIn("docker pull git.cellnucle.us/hugo/cageledger:1.2.3", body)
        self.assertNotIn("CageLedger-download.py.txt", body)
        # The old source-upload compatibility flag cannot make a formal metadata plan upload source.
        self.assertEqual(self.plan(include_source=True).manifest, plan.manifest)

    def test_image_only_filters_manifest_payloads_restore_and_official_body(self):
        plan = self.plan(include_source=True, offline_image=True, chunk_bytes=128)
        manifest = json.loads(plan.manifest)
        self.assertEqual(plan.tag, "v1.2.3")
        self.assertFalse(manifest["source_archive_included"])
        self.assertTrue(manifest["offline_image_included"])
        self.assertTrue(plan.offline_image)
        self.assertTrue(any(".part" in item.path.name for item in plan.payloads))
        self.assertIn(plan.directory / delivery.DOWNLOAD_NAME, plan.generated())
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

    def test_complete_draft_publishes_once_and_resumes_with_trusted_attachment_proof(self):
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

    def test_unverified_package_or_live_registry_conflict_cannot_create_or_publish_release(self):
        with self.assertRaisesRegex(delivery.DeliveryError, "verified Container Package"):
            self.plan(registry_proof={"status": "incomplete"})
        plan, client, state = self.plan(), OfficialMemory(), self.directory / "registry-conflict"
        self.registry_verification.side_effect = registry.RegistryError("Container Package registry digest changed.")
        with self.assertRaises(registry.RegistryError):
            release.release(plan, client, state, notes=NOTES, publish=True)
        self.assertIsNone(client.value)
        self.assertFalse((state / "receipt.json").exists())
        self.registry_verification.side_effect = lambda plan: json.loads(plan.manifest)["registry"]
        release.release(plan, client, state, notes=NOTES)
        self.registry_verification.side_effect = registry.RegistryError("Container Package registry digest changed.")
        with self.assertRaises(registry.RegistryError):
            release.publish_verified(plan, client, state, notes=NOTES)
        self.assertTrue(client.value["draft"])
        self.assertEqual(client.patches, 0)

    def test_legacy_or_other_delivery_mode_receipt_is_preserved_and_never_adopted(self):
        plan, client, state = self.plan(), OfficialMemory(), self.directory / "legacy"
        state.mkdir()
        original = json.dumps(
            {
                "identity": {**release.expected_identity(plan), "transport": "private-official-release-v1"},
                "ownership": "old-owner",
                "files": {},
            }
        )
        path = state / "receipt.json"
        path.write_text(original)
        with self.assertRaisesRegex(delivery.DeliveryError, "different artifacts or transport"):
            release.release(plan, client, state, notes=NOTES)
        self.assertEqual(path.read_text(), original)
        self.assertIsNone(client.value)
        self.assertNotEqual(
            release.expected_identity(plan)["transport"],
            release.expected_identity(self.plan(offline_image=True))["transport"],
        )

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


class RegistryBindingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.output = self.directory / "dist"
        self.output.mkdir()
        self.source = {"app_version": registry_fixtures.VERSION, "revision": registry_fixtures.REVISION}
        self.archive = self.output / f"CageLedger-image-{registry_fixtures.VERSION}-arm64.tar.gz"
        registry_fixtures.make_archive(self.archive)
        self.state = self.directory / "registry"
        self.prepared = registry.prepare_archive(
            self.archive, self.state, **{"version": self.source["app_version"], "revision": self.source["revision"]}
        )
        self.client = registry_fixtures.MemoryRegistry()
        self.receipt = registry.Publisher(self.prepared, self.state, self.client).publish()

    def evidence(self):
        return release_registry.registry_evidence(self.output, self.state, source=self.source)

    def test_matching_published_package_is_bound_without_uploading_or_reading_layers(self):
        evidence = self.evidence()
        plan = SimpleNamespace(identity=self.source, manifest=json.dumps({"registry": evidence}))
        writes = list(self.client.manifest_puts)
        calls = []
        original = self.client.request

        def track(method, path, **options):
            calls.append((method, path))
            return original(method, path, **options)

        with patch.object(self.client, "request", side_effect=track):
            self.assertEqual(release_registry.verify_registry(plan, client=self.client), evidence)
        self.assertEqual(self.client.manifest_puts, writes)
        config = self.prepared["config"]["digest"]
        self.assertEqual([path for method, path in calls if method == "GET"], [registry.BASE + "/blobs/" + config])
        self.assertNotIn("layout_directory", evidence)
        self.assertNotIn("tags", evidence)

    def test_missing_local_publication_proof_or_changed_remote_package_is_rejected(self):
        evidence = self.evidence()
        plan = SimpleNamespace(identity=self.source, manifest=json.dumps({"registry": evidence}))
        value = json.loads(self.receipt.read_text())
        value["status"] = "running"
        self.receipt.write_text(json.dumps(value))
        with self.assertRaisesRegex(registry.RegistryError, "matching verified"):
            self.evidence()
        tag = self.source["app_version"]
        self.client.tags[tag] = ("sha256:" + "0" * 64, self.client.tags[tag][1])
        with self.assertRaisesRegex(registry.RegistryError, "digest changed"):
            release_registry.verify_registry(plan, client=self.client)


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
