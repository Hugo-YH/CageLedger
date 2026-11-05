import io
import json
import sys
import tarfile
import tempfile
import unittest
import urllib.error
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
            return f"{REVISION}\trefs/heads/main"
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
        with self.assertRaisesRegex(delivery.DeliveryError, "Invalid Generic Package version"):
            delivery.prepare(self.repo, self.output, "../outside")

    def test_immutable_conflict_prevents_all_uploads_and_matching_files_are_reused(self):
        plan = self.plan()
        client = MemoryGitea()
        client.remote = {a.path.name: a.metadata() for a in plan.files()}
        client.remote[self.image.name] = {**client.remote[self.image.name], "sha256": "b" * 64}
        state = self.directory / "delivery"
        with self.assertRaisesRegex(delivery.DeliveryError, "Immutable remote file conflicts"):
            delivery.deliver(plan, client, state)
        self.assertEqual(client.uploaded, [])
        client.remote = {a.path.name: a.metadata() for a in plan.files()}
        receipt_path = delivery.deliver(plan, client, state)
        self.assertEqual(client.uploaded, [])
        receipt = json.loads(receipt_path.read_text())
        self.assertEqual(receipt["status"], "verified")
        self.assertEqual({v["status"] for v in receipt["files"].values()}, {"reused"})

    def test_upload_order_and_post_upload_hash_verification(self):
        plan = self.plan()
        client = MemoryGitea()
        receipt_path = delivery.deliver(plan, client, self.directory / "delivery")
        self.assertEqual(client.uploaded, [a.path.name for a in plan.files()])
        self.assertEqual(client.uploaded[0], plan.manifest_path.name)
        self.assertEqual(client.uploaded[-1], self.image.name)
        receipt = json.loads(receipt_path.read_text())
        self.assertEqual({v["status"] for v in receipt["files"].values()}, {"verified"})
        bad = MemoryGitea(corrupt=True)
        failed_state = self.directory / "failed"
        with self.assertRaisesRegex(delivery.DeliveryError, "Immutable remote file conflicts"):
            delivery.deliver(plan, bad, failed_state)
        failure = json.loads((failed_state / "receipt.json").read_text())
        self.assertEqual(failure["status"], "incomplete")
        self.assertEqual(failure["files"][plan.manifest_path.name]["status"], "unknown")
        self.assertEqual(len(bad.uploaded), 1)

    def test_bootstrap_is_linked_and_verified_before_source_put(self):
        plan = self.plan()
        client = PrivacyGitea()
        receipt_path = delivery.deliver(plan, client, self.directory / "private")
        puts = [(index, path) for index, (method, path) in enumerate(client.events) if method == "PUT"]
        self.assertTrue(puts[0][1].endswith(f"/{delivery.BOOTSTRAP_VERSION}/{delivery.BOOTSTRAP_FILE}"))
        link_index = next(index for index, (method, path) in enumerate(client.events) if method == "POST")
        private_index = next(
            index
            for index, (method, path) in enumerate(client.events)
            if method == "GET" and path.endswith("/" + delivery.BOOTSTRAP_VERSION)
        )
        self.assertLess(puts[0][0], link_index)
        self.assertLess(link_index, private_index)
        self.assertLess(private_index, puts[1][0])
        receipt = json.loads(receipt_path.read_text())
        self.assertEqual(receipt["privacy"]["repository_id"], 1)
        self.assertIn("bootstrap_marker", receipt["privacy"])

    def test_wrong_or_unknown_unlinked_package_never_receives_source(self):
        plan = self.plan()
        for wrong_repository in (None, {"id": 2, "full_name": "hugo/other", "private": True}):
            client = PrivacyGitea()
            client.stored["unknown-version"] = {"unknown.txt": {"name": "unknown.txt", "size": 0, "sha256": "a" * 64}}
            client.binding = wrong_repository
            with self.subTest(repository=wrong_repository), self.assertRaises(delivery.DeliveryError):
                delivery.deliver(plan, client, self.directory / ("unknown" if wrong_repository is None else "wrong"))
            self.assertFalse(any(method == "PUT" for method, path in client.events))
        unlinked = PrivacyGitea(link_effect=False)
        with self.assertRaisesRegex(delivery.DeliveryError, "not verified as linked"):
            delivery.deliver(plan, unlinked, self.directory / "link-failed")
        puts = [path for method, path in unlinked.events if method == "PUT"]
        self.assertEqual(len(puts), 1)
        self.assertTrue(puts[0].endswith("/" + delivery.BOOTSTRAP_FILE))

    def test_known_unlinked_bootstrap_can_resume_without_overwriting_marker(self):
        plan = self.plan()
        client = PrivacyGitea()
        client.stored[delivery.BOOTSTRAP_VERSION] = {
            delivery.BOOTSTRAP_FILE: {
                "name": delivery.BOOTSTRAP_FILE,
                "size": len(delivery.BOOTSTRAP_BODY),
                "sha256": delivery.hashlib.sha256(delivery.BOOTSTRAP_BODY).hexdigest(),
            }
        }
        delivery.deliver(plan, client, self.directory / "bootstrap-resume")
        self.assertFalse(
            any(method == "PUT" and path.endswith("/" + delivery.BOOTSTRAP_FILE) for method, path in client.events)
        )
        self.assertTrue(any(method == "POST" for method, path in client.events))

    def test_receipt_must_stay_outside_checkout(self):
        with self.assertRaisesRegex(delivery.DeliveryError, "outside the repository"):
            delivery.deliver(self.plan(), MemoryGitea(), self.repo / "receipt")


class MemoryGitea:
    def __init__(self, corrupt=False):
        self.remote = {}
        self.uploaded = []
        self.corrupt = corrupt

    def ensure_private(self):
        return {"status": "verified", "repository_id": 1, "anchor_version": delivery.BOOTSTRAP_VERSION}

    def verify_private(self, version, repository_id):
        if repository_id != 1:
            raise delivery.DeliveryError("Invalid private repository")

    def files(self, version):
        return {name: dict(metadata) for name, metadata in self.remote.items()}

    def upload(self, version, artifact):
        self.uploaded.append(artifact.path.name)
        self.remote[artifact.path.name] = artifact.metadata()
        if self.corrupt:
            self.remote[artifact.path.name]["sha256"] = "b" * 64


class PrivacyGitea(delivery.Gitea):
    def __init__(self, link_effect=True):
        super().__init__("test-binding")
        self.events = []
        self.stored = {}
        self.binding = None
        self.link_effect = link_effect

    def request(self, method, path, *, stream=None, size=None, missing=False):
        self.events.append((method, path))
        parts = delivery.urllib.parse.urlsplit(path).path.strip("/").split("/")
        if path == "/api/v1/repos/hugo/cageledger":
            value = {"id": 1, "full_name": "hugo/cageledger", "private": True}
        elif method == "GET" and "?" in path:
            value = [
                {"name": delivery.PACKAGE, "type": "generic", "version": version, "repository": self.binding}
                for version in self.stored
            ]
        elif method == "GET" and parts[-1] == "files":
            version = parts[-2]
            if version not in self.stored and missing:
                return None
            value = list(self.stored.get(version, {}).values())
        elif method == "GET":
            value = {"repository": self.binding}
        elif method == "POST":
            if self.link_effect:
                self.binding = {"id": 1, "full_name": "hugo/cageledger", "private": True}
            return b""
        elif method == "PUT":
            version, name = parts[-2:]
            body = stream.read()
            if len(body) != size:
                raise AssertionError("Wrong upload size")
            self.stored.setdefault(version, {})[name] = {
                "name": name,
                "size": size,
                "sha256": delivery.hashlib.sha256(body).hexdigest(),
            }
            return b""
        else:
            raise AssertionError("Unexpected fake API call")
        return json.dumps(value).encode()


class GiteaTransportTests(unittest.TestCase):
    def test_https_origin_is_fixed_and_redirects_are_rejected_without_echoing_response(self):
        for origin in ("http://git.cellnucle.us", "https://other.example", "https://user:password@git.cellnucle.us"):
            with self.subTest(origin=origin), self.assertRaisesRegex(delivery.DeliveryError, "HTTPS Gitea origin"):
                delivery.Gitea("test-binding", origin=origin)
        handler = delivery.NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, 302, "Found", {}, "https://other.example"))
        response = io.BytesIO(b"sensitive-response-must-not-be-printed")
        opener = type(
            "RedirectOpener",
            (),
            {
                "open": lambda *a, **kw: (_ for _ in ()).throw(
                    urllib.error.HTTPError(delivery.ORIGIN + "/api/example", 302, "secret-message", {}, response)
                )
            },
        )()
        with self.assertRaises(delivery.DeliveryError) as failure:
            delivery.Gitea("test-binding", opener=opener).request("GET", "/api/example")
        self.assertIn("HTTP 302", str(failure.exception))
        self.assertNotIn("secret", str(failure.exception))
        self.assertNotIn("sensitive", str(failure.exception))

    def test_put_body_is_a_bounded_file_stream_with_content_length(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "image.tar.gz"
            path.write_bytes(b"archive-bytes" * 3000)
            observed = {}

            class StreamOpener:
                def open(self, request, timeout):
                    self_outer.assertFalse(isinstance(request.data, bytes))
                    self_outer.assertTrue(hasattr(request.data, "read"))
                    observed["length"] = request.get_header("Content-length")
                    observed["authorization"] = request.get_header("Authorization")
                    observed["timeout"] = timeout
                    observed["method"] = request.get_method()
                    observed["bytes"] = 0
                    while chunk := request.data.read(8192):
                        self_outer.assertLessEqual(len(chunk), 8192)
                        observed["bytes"] += len(chunk)
                    return io.BytesIO(b"")

            self_outer = self
            client = delivery.Gitea("test-binding", opener=StreamOpener())
            artifact = delivery.Artifact.read(path)
            client.upload("1.2.3-dev.abc", artifact)
            self.assertEqual(observed["length"], str(artifact.size))
            self.assertEqual(observed["bytes"], artifact.size)
            self.assertEqual(observed["authorization"], "token test-binding")
            self.assertEqual(observed["timeout"], 120)
            self.assertEqual(observed["method"], "PUT")

    def test_file_metadata_requires_size_and_sha256(self):
        client = delivery.Gitea("test-binding")
        values = [{"name": "artifact", "size": 3, "sha256": "a" * 64}]
        with patch.object(client, "request", return_value=json.dumps(values).encode()):
            self.assertEqual(client.files("1.2.3")["artifact"]["sha256"], "a" * 64)
        with patch.object(client, "request", return_value=b'[{"name":"artifact","size":3}]'):
            with self.assertRaisesRegex(delivery.DeliveryError, "Invalid Gitea package metadata"):
                client.files("1.2.3")
