import copy
import hashlib
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import release_images as images


def json_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def write_oci_tar(path, members):
    with tarfile.open(path, "w") as archive:
        for name, body in members.items():
            member = tarfile.TarInfo(name)
            member.size = len(body)
            archive.addfile(member, io.BytesIO(body))


class RegistryHarness:
    """An in-memory registry; every side effect still crosses the publisher's hooks."""

    def __init__(self, root):
        self.root = root
        self.repo = root / "repo"
        self.repo.mkdir()
        self.directory = root / "evidence"
        self.version = "1.30.0"
        self.revision = "d" * 40
        self.remote = {}
        self.local = {}
        self.executions = []
        self.commands = []
        self.durable_before_push = []
        self.lose_push_response = None
        self.fail_build = None
        self.containerd_store = False
        self.omit_metadata = False
        self.metadata_override = None
        self.loaded_id_override = None
        self.omit_archive = False
        self.archive_missing_config = False

    def reference(self, arch=None):
        return f"{images.IMAGE}:{self.version}" + (f"-{arch}" if arch else "")

    def config_bytes(self, arch):
        return json_bytes(
            {
                "architecture": arch,
                "os": "linux",
                "config": {"Env": [f"CAGELEDGER_APP_VERSION={self.version}", f"CAGELEDGER_REVISION={self.revision}"]},
            }
        )

    def digest(self, arch):
        return "sha256:" + hashlib.sha256(self.config_bytes(arch)).hexdigest()

    def oci_manifest(self, arch):
        return {
            "schemaVersion": 2,
            "config": {
                "mediaType": "application/vnd.oci.image.config.v1+json",
                "digest": self.digest(arch),
                "size": len(self.config_bytes(arch)),
            },
            "layers": [],
        }

    def manifest_digest(self, arch):
        return "sha256:" + hashlib.sha256(json_bytes(self.oci_manifest(arch))).hexdigest()

    def create_archive(self, path, arch):
        manifest = self.oci_manifest(arch)
        if self.archive_missing_config:
            del manifest["config"]
        body = json_bytes(manifest)
        digest = "sha256:" + hashlib.sha256(body).hexdigest()
        write_oci_tar(
            path,
            {
                "oci-layout": json_bytes({"imageLayoutVersion": "1.0.0"}),
                "index.json": json_bytes(
                    {
                        "schemaVersion": 2,
                        "manifests": [{"digest": digest, "platform": {"os": "linux", "architecture": arch}}],
                    }
                ),
                "blobs/sha256/" + digest.split(":")[1]: body,
                "blobs/sha256/" + self.digest(arch).split(":")[1]: self.config_bytes(arch),
            },
        )

    def manifest(self, config):
        return {"schemaVersion": 2, "config": {"digest": config}, "layers": []}

    def remote_manifest(self, _repo, reference):
        return copy.deepcopy(self.remote.get(reference))

    def inspect_value(self, arch):
        return {
            "Id": self.loaded_id_override
            or (self.manifest_digest(arch) if self.containerd_store else self.digest(arch)),
            "Os": "linux",
            "Architecture": arch,
            "Config": {"Env": [f"CAGELEDGER_APP_VERSION={self.version}", f"CAGELEDGER_REVISION={self.revision}"]},
        }

    def command(self, args, _repo):
        self.commands.append(args)
        if args[:3] in (["git", "worktree", "add"], ["git", "worktree", "remove"]):
            return ""
        if args[:3] == ["docker", "image", "inspect"]:
            return json.dumps([self.local[args[3]]])
        raise AssertionError(f"Unexpected read command: {args}")

    def execute(self, args, output):
        self.executions.append(args)
        output.write_text("simulated container operation\n")
        if args[:3] == ["docker", "buildx", "build"]:
            arch = args[args.index("--platform") + 1].split("/")[1]
            if self.fail_build == arch:
                raise RuntimeError("simulated build interruption")
            self.local[args[args.index("-t") + 1]] = self.inspect_value(arch)
            if not self.omit_metadata:
                metadata = (
                    self.metadata_override
                    if self.metadata_override is not None
                    else {
                        "containerimage.config.digest": self.digest(arch),
                        "containerimage.digest": self.manifest_digest(arch),
                    }
                )
                Path(args[args.index("--metadata-file") + 1]).write_text(json.dumps(metadata))
            if not self.omit_archive:
                destination = args[args.index("--output") + 1].split("dest=", 1)[1]
                self.create_archive(Path(destination), arch)
        elif args[:2] == ["docker", "push"]:
            reference = args[2]
            arch = reference.rsplit("-", 1)[1]
            receipt = json.loads((self.directory / "image-publication.json").read_text())
            expected = receipt["architectures"][arch]["expected_config"]
            if (
                expected != self.digest(arch)
                or receipt["architectures"][arch]["local_id"] != self.local[reference]["Id"]
            ):
                raise AssertionError("Push started before the expected config and loaded image identity were saved")
            if (self.directory / f"{arch}-build.oci.tar").exists():
                raise AssertionError("The additional OCI archive was not removed after saving the receipt")
            self.durable_before_push.append((arch, expected))
            self.remote[reference] = self.manifest(expected)
            if self.lose_push_response == arch:
                self.lose_push_response = None
                raise RuntimeError("simulated connection loss after registry accepted push")
        elif args[:4] == ["docker", "buildx", "imagetools", "create"]:
            target = args[args.index("-t") + 1]
            if target == self.reference():
                self.create_index(target)
        elif args[:2] != ["bash", "scripts/package_offline_image.sh"]:
            raise AssertionError(f"Unexpected mutation command: {args}")

    def create_index(self, target):
        descriptors = []
        for index, arch in enumerate(images.ARCHES, 1):
            digest = "sha256:" + str(index) * 64
            self.remote[target + "@" + digest] = copy.deepcopy(self.remote[self.reference(arch)])
            descriptors.append({"digest": digest, "platform": {"os": "linux", "architecture": arch}})
        self.remote[target] = {"schemaVersion": 2, "manifests": descriptors}

    def publisher(self):
        return images.ImagePublisher(self.repo, self.version, self.revision, self.directory, self.execute)

    def mutations(self, prefix):
        return [args for args in self.executions if args[: len(prefix)] == prefix]


class ImagePublicationRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.harness = RegistryHarness(Path(self.temporary.name))
        self.command_patch = patch.object(images, "command", side_effect=self.harness.command)
        self.remote_patch = patch.object(images, "remote_manifest", side_effect=self.harness.remote_manifest)
        self.command_patch.start()
        self.remote_patch.start()
        self.addCleanup(self.command_patch.stop)
        self.addCleanup(self.remote_patch.stop)

    def test_local_config_is_durable_before_each_push(self):
        publisher = self.harness.publisher()
        publisher.architecture("arm64", self.harness.repo)
        self.assertEqual(self.harness.durable_before_push, [("arm64", self.harness.digest("arm64"))])
        self.assertTrue(publisher.data["architectures"]["arm64"]["verified"])
        self.assertEqual(len(self.harness.mutations(["docker", "buildx", "build"])), 1)
        self.assertEqual(len(self.harness.mutations(["docker", "push"])), 1)

    def test_containerd_loaded_id_is_distinct_from_registry_config_digest(self):
        self.harness.containerd_store = True
        publisher = self.harness.publisher()
        publisher.architecture("arm64", self.harness.repo)
        receipt = json.loads((self.harness.directory / "image-publication.json").read_text())["architectures"]["arm64"]
        self.assertEqual(receipt["expected_config"], self.harness.digest("arm64"))
        self.assertEqual(receipt["local_id"], self.harness.manifest_digest("arm64"))
        self.assertNotEqual(receipt["local_id"], receipt["expected_config"])
        self.assertEqual(
            self.harness.remote[self.harness.reference("arm64")]["config"]["digest"], receipt["expected_config"]
        )
        self.assertTrue(receipt["verified"])
        self.assertEqual(self.harness.durable_before_push, [("arm64", self.harness.digest("arm64"))])

    def test_missing_build_metadata_file_prevents_push(self):
        self.harness.omit_metadata = True
        publisher = self.harness.publisher()
        with self.assertRaises(FileNotFoundError):
            publisher.architecture("arm64", self.harness.repo)
        self.assertEqual(self.harness.mutations(["docker", "push"]), [])
        self.assertNotIn("arm64", publisher.data["architectures"])

    def test_missing_config_metadata_uses_the_actual_oci_archive(self):
        self.harness.containerd_store = True
        self.harness.metadata_override = {"containerimage.digest": self.harness.manifest_digest("arm64")}
        publisher = self.harness.publisher()
        publisher.architecture("arm64", self.harness.repo)
        self.assertEqual(publisher.data["architectures"]["arm64"]["expected_config"], self.harness.digest("arm64"))
        self.assertTrue(publisher.data["architectures"]["arm64"]["verified"])
        self.assertFalse((self.harness.directory / "arm64-build.oci.tar").exists())

    def test_missing_oci_archive_prevents_receipt_and_push(self):
        self.harness.omit_archive = True
        publisher = self.harness.publisher()
        with self.assertRaises(FileNotFoundError):
            publisher.architecture("arm64", self.harness.repo)
        self.assertEqual(self.harness.mutations(["docker", "push"]), [])
        self.assertNotIn("arm64", publisher.data["architectures"])

    def test_missing_oci_config_prevents_receipt_and_push(self):
        self.harness.archive_missing_config = True
        publisher = self.harness.publisher()
        with self.assertRaisesRegex(RuntimeError, "Buildx config digest missing"):
            publisher.architecture("arm64", self.harness.repo)
        self.assertEqual(self.harness.mutations(["docker", "push"]), [])
        self.assertNotIn("arm64", publisher.data["architectures"])

    def test_conflicting_metadata_config_does_not_override_the_oci_identity(self):
        self.harness.metadata_override = {"containerimage.config.digest": "sha256:" + "f" * 64}
        publisher = self.harness.publisher()
        with self.assertRaisesRegex(RuntimeError, "metadata and OCI config differ"):
            publisher.architecture("arm64", self.harness.repo)
        self.assertEqual(self.harness.mutations(["docker", "push"]), [])
        self.assertNotIn("arm64", publisher.data["architectures"])

    def test_containerd_load_export_digest_can_differ_from_oci_manifest(self):
        loaded_id = "sha256:" + "e" * 64
        self.harness.loaded_id_override = loaded_id
        self.harness.metadata_override = {"containerimage.digest": loaded_id}
        publisher = self.harness.publisher()
        publisher.architecture("arm64", self.harness.repo)
        receipt = publisher.data["architectures"]["arm64"]
        self.assertEqual(receipt["local_id"], loaded_id)
        self.assertNotEqual(loaded_id, self.harness.manifest_digest("arm64"))
        self.assertEqual(receipt["expected_config"], self.harness.digest("arm64"))

    def test_loaded_id_unrelated_to_build_metadata_prevents_receipt_and_push(self):
        self.harness.loaded_id_override = "sha256:" + "f" * 64
        publisher = self.harness.publisher()
        with self.assertRaisesRegex(RuntimeError, "Loaded image differs"):
            publisher.architecture("arm64", self.harness.repo)
        self.assertEqual(self.harness.mutations(["docker", "push"]), [])
        self.assertNotIn("arm64", publisher.data["architectures"])

    def test_lost_push_response_reconciles_remote_without_rebuild_or_repush(self):
        self.harness.containerd_store = True
        self.harness.lose_push_response = "arm64"
        with self.assertRaisesRegex(RuntimeError, "connection loss"):
            self.harness.publisher().architecture("arm64", self.harness.repo)
        persisted = json.loads((self.harness.directory / "image-publication.json").read_text())
        self.assertEqual(persisted["architectures"]["arm64"]["expected_config"], self.harness.digest("arm64"))
        self.assertNotIn("verified", persisted["architectures"]["arm64"])
        self.harness.local.clear()  # A verified remote config is sufficient even if the local image was removed.
        self.harness.publisher().architecture("arm64", self.harness.repo)
        self.assertEqual(len(self.harness.mutations(["docker", "buildx", "build"])), 1)
        self.assertEqual(len(self.harness.mutations(["docker", "push"])), 1)
        self.assertTrue(
            json.loads((self.harness.directory / "image-publication.json").read_text())["architectures"]["arm64"][
                "verified"
            ]
        )

    def test_arm64_interrupted_build_resumes_without_touching_historical_amd64(self):
        historical = self.harness.reference("amd64")
        historical_manifest = self.harness.manifest("sha256:" + "b" * 64)
        self.harness.remote[historical] = copy.deepcopy(historical_manifest)
        self.harness.fail_build = "arm64"
        with self.assertRaisesRegex(RuntimeError, "build interruption"):
            self.harness.publisher().publish()
        persisted = json.loads((self.harness.directory / "image-publication.json").read_text())
        self.assertEqual(persisted["architectures"], {})
        self.assertEqual(persisted["identity"]["platforms"], ["linux/arm64"])
        self.assertTrue(any(args[:3] == ["git", "worktree", "remove"] for args in self.harness.commands))
        previous = len(self.harness.executions)
        self.harness.fail_build = None
        publisher = self.harness.publisher()
        publisher.publish()
        resumed = self.harness.executions[previous:]
        builds = [args for args in resumed if args[:3] == ["docker", "buildx", "build"]]
        pushes = [args for args in resumed if args[:2] == ["docker", "push"]]
        self.assertEqual([args[args.index("--platform") + 1] for args in builds], ["linux/arm64"])
        self.assertEqual(pushes, [["docker", "push", self.harness.reference("arm64")]])
        self.assertEqual(self.harness.remote[historical], historical_manifest)
        self.assertTrue(publisher.data["manifest_verified"])
        self.assertEqual(len(self.harness.mutations(["bash", "scripts/package_offline_image.sh"])), 1)

    def test_legacy_dual_architecture_receipt_is_rejected_before_any_operation(self):
        publisher = self.harness.publisher()
        publisher.data["identity"].pop("platforms")
        publisher.data["architectures"] = {"arm64": {}, "amd64": {}}
        publisher.save()
        with self.assertRaisesRegex(RuntimeError, "architecture policy"):
            self.harness.publisher()
        self.assertEqual(self.harness.commands, [])
        self.assertEqual(self.harness.executions, [])

    def test_receipt_with_extra_architecture_is_not_accepted_under_new_identity(self):
        publisher = self.harness.publisher()
        publisher.data["architectures"]["amd64"] = {"verified": True}
        publisher.save()
        with self.assertRaisesRegex(RuntimeError, "obsolete architecture policy"):
            self.harness.publisher()

    def test_amd64_publication_is_refused_before_reading_or_building(self):
        with self.assertRaisesRegex(RuntimeError, "Only Linux ARM64"):
            self.harness.publisher().architecture("amd64", self.harness.repo)
        self.assertEqual(self.harness.commands, [])
        self.assertEqual(self.harness.executions, [])

    def test_old_multi_architecture_source_tag_cannot_be_republished(self):
        publisher = self.harness.publisher()
        publisher.data["architectures"]["arm64"] = {"expected_config": self.harness.digest("arm64")}
        publisher.save()
        reference = self.harness.reference("arm64")
        self.harness.remote[reference] = {
            "manifests": [
                {"platform": {"os": "linux", "architecture": architecture}, "digest": "sha256:" + str(index) * 64}
                for index, architecture in enumerate(("arm64", "amd64"), 1)
            ]
        }
        before = copy.deepcopy(self.harness.remote)
        with self.assertRaisesRegex(RuntimeError, "only Linux ARM64"):
            self.harness.publisher().architecture("arm64", self.harness.repo)
        self.assertEqual(self.harness.remote, before)
        self.assertEqual(self.harness.executions, [])

    def test_existing_architecture_without_pre_push_receipt_is_not_adopted(self):
        self.harness.remote[self.harness.reference("arm64")] = self.harness.manifest(self.harness.digest("arm64"))
        with self.assertRaisesRegex(RuntimeError, "no pre-push ownership receipt"):
            self.harness.publisher().architecture("arm64", self.harness.repo)
        self.assertEqual(self.harness.executions, [])

    def test_existing_index_without_receipt_stops_before_worktree_or_mutations(self):
        self.harness.remote[self.harness.reference()] = {"schemaVersion": 2, "manifests": [{"digest": "foreign"}]}
        with self.assertRaisesRegex(RuntimeError, "no ownership receipt"):
            self.harness.publisher().publish()
        self.assertEqual(self.harness.commands, [])
        self.assertEqual(self.harness.executions, [])

    def test_conflicting_architecture_is_rejected_without_overwrite(self):
        publisher = self.harness.publisher()
        publisher.data["architectures"]["arm64"] = {"expected_config": self.harness.digest("arm64")}
        publisher.save()
        foreign = self.harness.manifest("sha256:" + "f" * 64)
        self.harness.remote[self.harness.reference("arm64")] = foreign
        with self.assertRaisesRegex(RuntimeError, "conflicts with receipt"):
            self.harness.publisher().architecture("arm64", self.harness.repo)
        self.assertEqual(self.harness.remote[self.harness.reference("arm64")], foreign)
        self.assertEqual(self.harness.executions, [])

    def test_tag_appearing_during_build_is_checked_before_push(self):
        foreign = self.harness.manifest("sha256:" + "f" * 64)
        reads = 0

        def appearing_remote(_repo, reference):
            nonlocal reads
            reads += 1
            if reads == 1:
                return None
            self.harness.remote[reference] = foreign
            return copy.deepcopy(foreign)

        with patch.object(images, "remote_manifest", side_effect=appearing_remote):
            with self.assertRaisesRegex(RuntimeError, "does not match local build"):
                self.harness.publisher().architecture("arm64", self.harness.repo)
        self.assertEqual(len(self.harness.mutations(["docker", "buildx", "build"])), 1)
        self.assertEqual(self.harness.mutations(["docker", "push"]), [])
        self.assertEqual(self.harness.remote[self.harness.reference("arm64")], foreign)

    def test_conflicting_index_is_verified_and_never_replaced(self):
        publisher = self.harness.publisher()
        publisher.data["base_synced"] = True
        for arch in images.ARCHES:
            publisher.data["architectures"][arch] = {"expected_config": self.harness.digest(arch), "verified": True}
            self.harness.remote[self.harness.reference(arch)] = self.harness.manifest(self.harness.digest(arch))
        publisher.save()
        self.harness.create_index(self.harness.reference())
        self.harness.remote[self.harness.reference() + "@sha256:" + "1" * 64] = self.harness.manifest(
            "sha256:" + "f" * 64
        )
        foreign = copy.deepcopy(self.harness.remote)
        with self.assertRaisesRegex(RuntimeError, "Release manifest conflicts"):
            self.harness.publisher().publish()
        self.assertEqual(self.harness.remote, foreign)
        self.assertEqual(self.harness.executions, [])

    def test_rebuild_is_refused_if_saved_local_image_was_replaced(self):
        publisher = self.harness.publisher()
        publisher.data["architectures"]["arm64"] = {
            "expected_config": self.harness.digest("arm64"),
            "local_id": self.harness.digest("arm64"),
        }
        publisher.save()
        value = self.harness.inspect_value("arm64")
        value["Id"] = "sha256:" + "f" * 64
        self.harness.local[self.harness.reference("arm64")] = value
        with self.assertRaisesRegex(RuntimeError, "Local image changed/missing"):
            self.harness.publisher().architecture("arm64", self.harness.repo)
        self.assertEqual(self.harness.executions, [])

    def test_receipt_cannot_be_reused_by_another_revision(self):
        self.harness.publisher()
        self.harness.revision = "e" * 40
        with self.assertRaisesRegex(RuntimeError, "different release"):
            self.harness.publisher()
        self.assertEqual(self.harness.executions, [])


class ArchiveIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.harness = RegistryHarness(Path(self.temporary.name))
        self.path = self.harness.root / "image.oci.tar"

    def test_reads_config_from_manifest_blob_in_a_real_oci_tar(self):
        self.harness.create_archive(self.path, "arm64")
        self.assertEqual(
            images.archive_identity(self.path), (self.harness.digest("arm64"), self.harness.manifest_digest("arm64"))
        )

    def test_missing_index_does_not_guess_a_config_from_another_blob(self):
        write_oci_tar(
            self.path, {"blobs/sha256/" + "a" * 64: json_bytes({"config": {"digest": self.harness.digest("arm64")}})}
        )
        with self.assertRaises(KeyError):
            images.archive_identity(self.path)

    def test_multi_platform_archive_is_not_accepted_as_single_build_identity(self):
        write_oci_tar(
            self.path,
            {
                "index.json": json_bytes(
                    {
                        "manifests": [
                            {"digest": self.harness.manifest_digest("arm64")},
                            {"digest": self.harness.manifest_digest("amd64")},
                        ]
                    }
                )
            },
        )
        with self.assertRaisesRegex(RuntimeError, "single-platform"):
            images.archive_identity(self.path)

    def test_invalid_descriptor_is_rejected_before_blob_lookup(self):
        write_oci_tar(self.path, {"index.json": json_bytes({"manifests": [{"digest": "../../outside-file"}]})})
        with self.assertRaisesRegex(RuntimeError, "Invalid OCI manifest digest"):
            images.archive_identity(self.path)

    def test_metadata_symlink_is_not_followed(self):
        with tarfile.open(self.path, "w") as archive:
            link = tarfile.TarInfo("index.json")
            link.type = tarfile.SYMTYPE
            link.linkname = "outside-file"
            archive.addfile(link)
        with self.assertRaisesRegex(RuntimeError, "Invalid OCI metadata member"):
            images.archive_identity(self.path)


class RegistryStateTests(unittest.TestCase):
    def test_exact_reference_scoped_absence_is_the_only_missing_result(self):
        reference = f"{images.IMAGE}:1.30.0-arm64"
        result = subprocess.CompletedProcess([], 1, "", f"ERROR: {reference}: not found\n")
        with patch.object(images.subprocess, "run", return_value=result):
            self.assertIsNone(images.remote_manifest(Path("."), reference))

    def test_network_auth_and_ambiguous_errors_stop_before_mutation(self):
        for diagnostic in (
            "network connection reset",
            "unauthorized: authentication required",
            "ERROR: another-registry/image:1.30.0-arm64: not found",
            "404 Not Found",
            "manifest unknown",
        ):
            with self.subTest(diagnostic=diagnostic), tempfile.TemporaryDirectory() as temporary:
                execute = Mock()
                publisher = images.ImagePublisher(
                    Path(temporary), "1.30.0", "d" * 40, Path(temporary) / "state", execute
                )
                result = subprocess.CompletedProcess([], 1, "", diagnostic)
                with patch.object(images.subprocess, "run", return_value=result):
                    with self.assertRaisesRegex(RuntimeError, "state unknown"):
                        publisher.architecture("arm64", Path(temporary))
                execute.assert_not_called()

    def test_registry_timeout_is_not_treated_as_missing(self):
        reference = f"{images.IMAGE}:1.30.0-arm64"
        with patch.object(images.subprocess, "run", side_effect=subprocess.TimeoutExpired("docker", 60)):
            with self.assertRaises(subprocess.TimeoutExpired):
                images.remote_manifest(Path("."), reference)


if __name__ == "__main__":
    unittest.main()
