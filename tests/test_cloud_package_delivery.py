import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import cloud_package_delivery as delivery

REVISION = "a" * 40


def tar_bytes(path, entries):
    with tarfile.open(path, "w:gz") as archive:
        for name, content in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))


class LocalArtifacts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.repo = self.directory / "repo"
        self.repo.mkdir()
        self.output = self.repo / "dist"
        self.output.mkdir()
        self.source = {
            "package.json": json.dumps({"version": "1.2.3", "build": 42}).encode(),
            "server.py": b"print('committed source')\n",
            "Dockerfile": b"FROM python:3.13-slim\n",
        }
        for name, content in self.source.items():
            (self.repo / name).write_bytes(content)
        self.source_archive = self.output / "CageLedger-offline-1.2.3.tar.gz"
        tar_bytes(self.source_archive, {f"cageledger/{name}": value for name, value in self.source.items()})
        self.image = self.output / "CageLedger-image-1.2.3-arm64.tar.gz"
        config = {
            "os": "linux",
            "architecture": "arm64",
            "config": {"Env": ["CAGELEDGER_APP_VERSION=1.2.3", f"CAGELEDGER_REVISION={REVISION}"]},
        }
        tar_bytes(
            self.image,
            {
                "manifest.json": json.dumps(
                    [{"Config": "config.json", "Layers": ["layer.tar"], "RepoTags": [f"{delivery.IMAGE}:1.2.3-arm64"]}]
                ).encode(),
                "config.json": json.dumps(config).encode(),
                "layer.tar": b"small Docker image layer",
            },
        )
        self.notes = self.output / "CageLedger-image-1.2.3-load.txt"
        self.notes.write_text("Load the ARM64 Docker archive.\n")
        (self.output / "CageLedger-image-1.2.3-sha256.txt").write_text(
            "".join(f"{delivery.sha256_file(p)}  {p}\n" for p in (self.image, self.notes))
        )
        self.git = patch.object(delivery, "git", side_effect=self.git_result).start()
        self.addCleanup(patch.stopall)

    def git_result(self, repo, *arguments):
        if arguments[0] == "status":
            return ""
        if arguments[0] == "branch":
            return "main"
        if arguments[0] == "rev-parse":
            return REVISION
        if arguments[0] == "remote":
            return f"{delivery.ORIGIN}/hugo/cageledger.git"
        if arguments[0] == "ls-remote":
            return "" if any(arg.startswith("refs/tags/") for arg in arguments) else f"{REVISION}\trefs/heads/main"
        if arguments[0] == "ls-files":
            return "\0".join(self.source) + "\0"
        self.fail(f"Unexpected Git command: {arguments}")

    def plan(self):
        return delivery.prepare(self.repo, self.output)

    def test_clean_source_and_remote_revision_are_required(self):
        result = self.plan()
        self.assertEqual(result.version, f"1.2.3-dev.{REVISION[:12]}")
        self.assertIn(
            ("ls-remote", "--exit-code", "gitea", "refs/heads/main"),
            [call.args[1:] for call in self.git.call_args_list],
        )
        with patch.object(delivery, "git", return_value=" M server.py"):
            with self.assertRaisesRegex(delivery.DeliveryError, "Commit all source"):
                self.plan()
        original = self.git_result
        with patch.object(
            delivery,
            "git",
            side_effect=lambda repo, *args: "b" * 40 + "\trefs/heads/main"
            if args[0] == "ls-remote"
            else original(repo, *args),
        ):
            with self.assertRaisesRegex(delivery.DeliveryError, "Gitea branch differs"):
                self.plan()

    def test_manifest_is_deterministic_and_dry_preparation_writes_nothing(self):
        first = delivery.prepare(self.repo, self.output, check_remote=False)
        second = delivery.prepare(self.repo, self.output, check_remote=False)
        self.assertEqual(first.manifest, second.manifest)
        value = json.loads(first.manifest)
        self.assertEqual(value["source"]["revision"], REVISION)
        self.assertEqual(value["source_archive_tracked_files_verified"], 3)
        self.assertEqual(value["platforms"], ["linux/arm64"])
        self.assertEqual(value["image_tag"], f"{delivery.IMAGE}:1.2.3-arm64")
        self.assertFalse(first.manifest_path.exists())
        self.assertNotIn("ls-remote", [call.args[1] for call in self.git.call_args_list])

    def test_stale_source_with_same_version_and_runtime_entries_are_rejected(self):
        (self.repo / "server.py").write_bytes(b"print('new committed source')\n")
        with self.assertRaisesRegex(delivery.DeliveryError, "source differs from HEAD: server.py"):
            self.plan()
        (self.repo / "server.py").write_bytes(self.source["server.py"])
        tar_bytes(self.source_archive, {"cageledger/.env": b"NOT_A_REAL_SECRET=example\n"})
        with self.assertRaisesRegex(delivery.DeliveryError, "runtime or credential"):
            self.plan()

    def test_version_checksum_and_required_source_guards(self):
        tar_bytes(self.source_archive, {"cageledger/package.json": self.source["package.json"]})
        with self.assertRaisesRegex(delivery.DeliveryError, "required committed source"):
            self.plan()
        tar_bytes(self.source_archive, {f"cageledger/{name}": value for name, value in self.source.items()})
        self.notes.write_text("changed after checksums were generated")
        with self.assertRaisesRegex(delivery.DeliveryError, "checksum file differs"):
            self.plan()
        with self.assertRaisesRegex(delivery.DeliveryError, "Development draft version"):
            delivery.prepare(self.repo, self.output, "../outside")

    def test_split_parts_are_ordered_and_restore_the_identical_archive(self):
        artifact_path = self.output / "payload.tar.gz"
        content = bytes(range(256)) * 3
        artifact_path.write_bytes(content)
        original = delivery.Artifact.read(artifact_path)
        parts = delivery.split_artifact(original, 91, self.output / "parts", write=True)
        self.assertGreater(len(parts), 1)
        self.assertEqual(b"".join(part.path.read_bytes() for part in parts), content)
        self.assertEqual(delivery.sha256_file(artifact_path), original.sha256)
        self.assertTrue(all(part.size <= 91 and part.path.name.endswith(".gz") for part in parts))
        self.assertEqual(parts[0].path.name, "payload.tar.part0001.gz")
        dry = delivery.split_artifact(original, 91, self.output / "dry-parts", write=False)
        self.assertEqual([part.sha256 for part in dry], [part.sha256 for part in parts])
        self.assertFalse((self.output / "dry-parts").exists())
        plan = delivery.prepare(self.repo, self.output, chunk_bytes=128, write_parts=True)
        manifest = json.loads(plan.manifest)
        self.assertTrue(all(record["sha256"] and record["attachments"] for record in manifest["artifacts"]))
        self.assertIn(b"NOT independently decompressible", plan.restore)
        self.assertIn(delivery.DOWNLOAD_NAME, [path.name for path in plan.generated()])

    def test_owned_draft_and_raw_probe_precede_sensitive_upload_and_allow_resume(self):
        plan, client = self.plan(), MemoryRelease()
        state = self.directory / "delivery"
        receipt_path = delivery.deliver(plan, client, state)
        self.assertTrue(client.value["draft"])
        self.assertTrue(client.value["prerelease"])
        self.assertEqual(client.value["target_commitish"], REVISION)
        self.assertEqual(client.value["tag_name"], "v" + plan.version)
        self.assertEqual(client.uploaded[0], delivery.PROBE_NAME)
        self.assertEqual(client.uploaded[1], plan.manifest_path.name)
        self.assertEqual(client.uploaded[-1], self.image.name)
        self.assertLess(client.events.index("anonymous"), client.events.index("upload:" + plan.manifest_path.name))
        receipt = json.loads(receipt_path.read_text())
        self.assertEqual(receipt["status"], "verified_draft")
        self.assertIn(receipt["ownership"], client.value["body"])
        uploaded = list(client.uploaded)
        delivery.deliver(plan, client, state)
        self.assertEqual(client.uploaded, uploaded)
        receipt = json.loads(receipt_path.read_text())
        self.assertEqual({value["status"] for value in receipt["files"].values()}, {"reused"})
        self.assertTrue(client.verified)

    def test_anonymous_readability_blocks_source_even_when_repository_metadata_is_private(self):
        client = MemoryRelease(public=True)
        with self.assertRaisesRegex(delivery.AssetError, "anonymously accessible"):
            delivery.deliver(self.plan(), client, self.directory / "public")
        self.assertEqual(client.uploaded, [delivery.PROBE_NAME])

    def test_unknown_same_tag_or_changed_owner_draft_is_not_adopted(self):
        plan, client = self.plan(), MemoryRelease()
        client.value = {**delivery.release_payload(plan, "unknown"), "id": 19, "author": client.actor()}
        with self.assertRaisesRegex(delivery.DeliveryError, "Unknown draft ownership"):
            delivery.deliver(plan, client, self.directory / "unknown")
        self.assertEqual(client.uploaded, [])
        client = MemoryRelease()
        state = self.directory / "owner"
        delivery.deliver(plan, client, state)
        client.value["author"] = {"id": 999, "login": "other"}
        previous = list(client.uploaded)
        with self.assertRaisesRegex(delivery.DeliveryError, "different author"):
            delivery.deliver(plan, client, state)
        self.assertEqual(client.uploaded, previous)

    def test_full_download_hash_is_required_for_existing_and_new_attachments(self):
        plan, client = self.plan(), MemoryRelease()
        state = self.directory / "immutable"
        delivery.deliver(plan, client, state)
        remote_id = client.remote[self.image.name]["id"]
        body = client.contents[remote_id]
        client.contents[remote_id] = b"X" + body[1:]
        previous = list(client.uploaded)
        with self.assertRaisesRegex(delivery.AssetError, "SHA256 conflict"):
            delivery.deliver(plan, client, state)
        self.assertEqual(client.uploaded, previous)
        bad = MemoryRelease(corrupt=True)
        failed_state = self.directory / "failed"
        with self.assertRaisesRegex(delivery.AssetError, "SHA256 conflict"):
            delivery.deliver(plan, bad, failed_state)
        receipt = json.loads((failed_state / "receipt.json").read_text())
        self.assertEqual(receipt["status"], "incomplete")
        self.assertEqual(receipt["files"][plan.manifest_path.name]["status"], "unknown")
        self.assertEqual(len(bad.uploaded), 2)

    def test_receipt_must_stay_outside_checkout(self):
        with self.assertRaisesRegex(delivery.DeliveryError, "outside the repository"):
            delivery.deliver(self.plan(), MemoryRelease(), self.repo / "receipt")


class MemoryRelease:
    def __init__(self, public=False, corrupt=False):
        self.value = None
        self.remote = {}
        self.contents = {}
        self.uploaded = []
        self.verified = []
        self.events = []
        self.public = public
        self.corrupt = corrupt

    def repository(self):
        return 1

    def actor(self):
        return {"id": 7, "login": "hugo"}

    def find(self, tag):
        return self.value

    def create(self, payload):
        self.value = {**payload, "id": 19, "author": self.actor()}
        return self.value

    def release(self, release_id):
        return self.value

    def assets(self, release_id):
        return {name: dict(value) for name, value in self.remote.items()}

    def upload(self, release_id, artifact):
        name = artifact.path.name
        self.events.append("upload:" + name)
        self.uploaded.append(name)
        asset_id = len(self.remote) + 1
        self.remote[name] = {
            "name": name,
            "size": artifact.size,
            "id": asset_id,
            "browser_download_url": delivery.ORIGIN + "/hugo/cageledger/releases/download/dev/" + name,
        }
        content = artifact.path.read_bytes()
        if self.corrupt and name != delivery.PROBE_NAME:
            content = b"X" + content[1:]
        self.contents[asset_id] = content

    def verify(self, attachment, artifact):
        self.verified.append(attachment["name"])
        body = self.contents[attachment["id"]]
        if len(body) != artifact.size or delivery.hashlib.sha256(body).hexdigest() != artifact.sha256:
            raise delivery.AssetError("Immutable attachment SHA256 conflict")

    def anonymous_denied(self, attachment):
        self.events.append("anonymous")
        if self.public:
            raise delivery.AssetError("Raw attachment is anonymously accessible")
        return {"status": 404, "raw_attachment_access": "denied"}
