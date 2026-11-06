import io
import json
import shutil
import sys
import tarfile
import tempfile
import unittest
from collections import Counter
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

    def test_cli_requires_explicit_offline_image_before_preparing_or_splitting(self):
        with patch.object(sys, "argv", ["publish:cloud"]), patch.object(delivery, "prepare") as prepare:
            with self.assertRaisesRegex(delivery.DeliveryError, "publish:registry"):
                delivery.main()
        prepare.assert_not_called()

    def test_legacy_source_flag_cannot_add_source_to_explicit_offline_cli(self):
        with (
            patch.object(sys, "argv", ["publish:cloud", "--offline-image", "--no-image-only", "--dry-run"]),
            patch.object(delivery, "prepare", return_value=self.plan()) as prepare,
            patch("builtins.print"),
        ):
            delivery.main()
        self.assertFalse(prepare.call_args.kwargs["include_source"])

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
        self.assertEqual(receipt["verification"]["reused_hash_receipts"], len(plan.files()))

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

    def test_boundary_checks_are_constant_and_new_uploads_hash_each_file_once(self):
        outputs = [self.output, self.output / "many-pieces"]
        outputs[1].mkdir()
        for source in (self.source_archive, self.image, self.notes, self.output / "CageLedger-image-1.2.3-sha256.txt"):
            shutil.copy2(source, outputs[1] / source.name)
        file_counts = []
        for index, output in enumerate(outputs):
            plan = delivery.prepare(
                self.repo, output, chunk_bytes=8 * 1024 * 1024 if index == 0 else 128, write_parts=True
            )
            client = MemoryRelease()
            path = delivery.deliver(plan, client, self.directory / f"boundaries-{index}")
            self.assertEqual(client.calls["repository"], 2)
            self.assertEqual(client.calls["release"], 1)
            self.assertEqual(client.calls["assets"], 2)
            self.assertEqual(client.calls["anonymous"], 2)
            reads = Counter(client.body_reads)
            self.assertEqual(reads[delivery.PROBE_NAME], 2)
            for artifact in plan.files():
                self.assertEqual(reads[artifact.path.name], 1)
            receipt = json.loads(path.read_text())
            self.assertEqual(receipt["verification"]["fresh_full_hash_files"], len(plan.files()))
            self.assertEqual(
                receipt["verification"]["remote_artifact_bytes_verified_this_run"],
                sum(file.size for file in plan.files()),
            )
            file_counts.append(len(plan.files()))
        self.assertGreater(file_counts[1], file_counts[0])

    def test_complete_receipts_and_legacy_complete_evidence_resume_without_artifact_downloads(self):
        plan, client, state = self.plan(), MemoryRelease(), self.directory / "resume"
        path = delivery.deliver(plan, client, state)
        receipt = json.loads(path.read_text())
        for record in receipt["files"].values():
            for key in ("attachment_identity", "verification_scope", "remote_bytes_hashed_this_run"):
                record.pop(key, None)
        path.write_text(json.dumps(receipt))
        client.body_reads.clear()
        previous = list(client.uploaded)
        delivery.deliver(plan, client, state)
        self.assertEqual(client.uploaded, previous)
        self.assertEqual(client.body_reads, [delivery.PROBE_NAME, delivery.PROBE_NAME])
        receipt = json.loads(path.read_text())
        self.assertEqual(receipt["verification"]["remote_artifact_bytes_verified_this_run"], 0)
        self.assertEqual(
            {record["verification_scope"] for record in receipt["files"].values()}, {"prior_full_sha256_receipt"}
        )
        self.assertTrue(all(record["remote_bytes_hashed_this_run"] == 0 for record in receipt["files"].values()))

    def test_unknown_or_incomplete_or_changed_expected_receipt_reverifies_only_that_file(self):
        plan, client, state = self.plan(), MemoryRelease(), self.directory / "proof"
        path = delivery.deliver(plan, client, state)
        for change in ("unknown", "sha256", "size", "missing_url", "missing_record"):
            with self.subTest(change=change):
                receipt = json.loads(path.read_text())
                record = receipt["files"][self.image.name]
                if change == "unknown":
                    record["status"] = "unknown"
                elif change == "sha256":
                    record["sha256"] = "b" * 64
                elif change == "size":
                    record["size"] += 1
                elif change == "missing_url":
                    record.pop("browser_download_url")
                else:
                    receipt["files"].pop(self.image.name)
                path.write_text(json.dumps(receipt))
                client.body_reads.clear()
                delivery.deliver(plan, client, state)
                self.assertEqual([name for name in client.body_reads if name != delivery.PROBE_NAME], [self.image.name])
                repaired = json.loads(path.read_text())["files"][self.image.name]
                self.assertEqual(repaired["verification_scope"], "full_remote_sha256")

    def test_changed_remote_id_or_url_requires_fresh_hash_and_size_conflicts_fail(self):
        plan, client, state = self.plan(), MemoryRelease(), self.directory / "identity"
        path = delivery.deliver(plan, client, state)
        remote = client.remote[self.image.name]
        old_id = remote["id"]
        for change in ("id", "url"):
            if change == "id":
                remote["id"] = 1000
                client.contents[remote["id"]] = client.contents[old_id]
            else:
                remote["browser_download_url"] = delivery.ORIGIN + "/attachments/replacement"
            client.body_reads.clear()
            delivery.deliver(plan, client, state)
            self.assertEqual([name for name in client.body_reads if name != delivery.PROBE_NAME], [self.image.name])
            receipt = json.loads(path.read_text())["files"][self.image.name]
            self.assertEqual(receipt["attachment_id"], 1000)
        remote["size"] += 1
        previous = list(client.uploaded)
        with self.assertRaisesRegex(delivery.AssetError, "size/name conflict"):
            delivery.deliver(plan, client, state)
        self.assertEqual(client.uploaded, previous)
        self.assertEqual(json.loads(path.read_text())["files"][self.image.name]["status"], "unknown")

    def test_audit_detects_same_identity_corruption_and_invalidates_cached_proof(self):
        plan, client, state = self.plan(), MemoryRelease(), self.directory / "audit"
        path = delivery.deliver(plan, client, state)
        remote_id = client.remote[self.image.name]["id"]
        body = client.contents[remote_id]
        client.contents[remote_id] = b"X" + body[1:]
        client.body_reads.clear()
        delivery.deliver(plan, client, state)
        self.assertEqual(client.body_reads, [delivery.PROBE_NAME, delivery.PROBE_NAME])
        with self.assertRaisesRegex(delivery.AssetError, "SHA256 conflict"):
            delivery.deliver(plan, client, state, audit_remote=True)
        receipt = json.loads(path.read_text())
        self.assertTrue(receipt["verification"]["audit_remote"])
        self.assertEqual(receipt["files"][self.image.name]["status"], "unknown")
        with self.assertRaisesRegex(delivery.AssetError, "SHA256 conflict"):
            delivery.deliver(plan, client, state)

    def test_new_upload_still_requires_full_remote_sha_and_final_metadata_must_match(self):
        plan = self.plan()
        bad = MemoryRelease(corrupt=True)
        state = self.directory / "failed"
        with self.assertRaisesRegex(delivery.AssetError, "SHA256 conflict"):
            delivery.deliver(plan, bad, state)
        failure = json.loads((state / "receipt.json").read_text())
        self.assertEqual(failure["files"][plan.manifest_path.name]["status"], "unknown")
        self.assertEqual(len(bad.uploaded), 2)
        final_change = MemoryRelease()
        original_assets = final_change.assets

        def changed_assets(release_id):
            values = original_assets(release_id)
            if final_change.calls["assets"] == 2:
                values[self.image.name]["id"] += 100
            return values

        with patch.object(final_change, "assets", side_effect=changed_assets):
            with self.assertRaisesRegex(delivery.DeliveryError, "Final draft attachment identity changed"):
                delivery.deliver(plan, final_change, self.directory / "final-change")
        self.assertEqual(final_change.calls["anonymous"], 1)
        self.assertEqual(json.loads((self.directory / "final-change/receipt.json").read_text())["status"], "incomplete")

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
        self.body_reads = []
        self.calls = Counter()
        self.events = []
        self.public = public
        self.corrupt = corrupt

    def repository(self):
        self.calls["repository"] += 1
        return 1

    def actor(self):
        self.calls["actor"] += 1
        return {"id": 7, "login": "hugo"}

    def find(self, tag):
        self.calls["find"] += 1
        return self.value

    def create(self, payload):
        self.value = {**payload, "id": 19, "author": {"id": 7, "login": "hugo"}}
        return self.value

    def release(self, release_id):
        self.calls["release"] += 1
        return self.value

    def assets(self, release_id):
        self.calls["assets"] += 1
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
        return dict(self.remote[name])

    def verify(self, attachment, artifact):
        self.verified.append(attachment["name"])
        if attachment["name"] != artifact.path.name or attachment["size"] != artifact.size:
            raise delivery.AssetError("Immutable attachment size/name conflict")
        self.body_reads.append(attachment["name"])
        body = self.contents[attachment["id"]]
        if len(body) != artifact.size or delivery.hashlib.sha256(body).hexdigest() != artifact.sha256:
            raise delivery.AssetError("Immutable attachment SHA256 conflict")

    def anonymous_denied(self, attachment):
        self.calls["anonymous"] += 1
        self.events.append("anonymous")
        if self.public:
            raise delivery.AssetError("Raw attachment is anonymously accessible")
        return {"status": 404, "raw_attachment_access": "denied"}
