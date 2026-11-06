import gzip
import hashlib
import io
import json
import random
import sys
import tarfile
import tempfile
import unittest
import urllib.error
import urllib.parse
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import cloud_registry as registry

VERSION, REVISION = "1.30.1", "a" * 40


def sha(body):
    return "sha256:" + hashlib.sha256(body).hexdigest()


def make_archive(path, *, large=False, compression=registry.LAYER, corrupt=False):
    original = random.Random(7).randbytes(registry.CHUNK + 101) if large else b"synthetic root filesystem bytes" * 100
    layer = gzip.compress(original, mtime=0)
    config = registry.encoded(
        {
            "os": "linux",
            "architecture": "arm64",
            "rootfs": {"type": "layers", "diff_ids": [sha(original)]},
            "config": {"Env": ["CAGELEDGER_APP_VERSION=" + VERSION, "CAGELEDGER_REVISION=" + REVISION]},
        }
    )
    config_descriptor = {"digest": sha(config), "size": len(config), "mediaType": registry.CONFIG}
    layer_descriptor = {"digest": sha(layer), "size": len(layer), "mediaType": compression}
    manifest = registry.encoded(
        {"schemaVersion": 2, "mediaType": registry.IMAGE, "config": config_descriptor, "layers": [layer_descriptor]}
    )
    index = registry.encoded(
        {
            "schemaVersion": 2,
            "mediaType": registry.INDEX,
            "manifests": [
                {
                    "digest": sha(manifest),
                    "size": len(manifest),
                    "mediaType": registry.IMAGE,
                    "platform": {"os": "linux", "architecture": "arm64"},
                }
            ],
        }
    )
    files = {"oci-layout": registry.encoded({"imageLayoutVersion": "1.0.0"}), "index.json": index}
    files.update({"blobs/sha256/" + sha(body).split(":")[1]: body for body in (config, manifest, layer)})
    if corrupt:
        files["blobs/sha256/" + sha(layer).split(":")[1]] = b"X" + layer[1:]
    with tarfile.open(path, "w:gz") as archive:
        for name, body in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(body)
            archive.addfile(member, io.BytesIO(body))
    return config, layer


class MemoryRegistry:
    def __init__(self):
        self.blobs, self.uploads, self.tags = {}, {}, {}
        self.patch_bytes = []
        self.manifest_puts = []
        self.fail_after_patch = False
        self.fail_after_manifest = False

    def location(self, value):
        return registry.checked_url(value)

    def manifest(self, reference):
        return self.tags.get(reference)

    def request(self, method, url, *, body=None, headers=None, missing=False):
        parsed = urllib.parse.urlsplit(url)
        path = parsed.path
        if method == "HEAD" and "/blobs/sha256:" in path:
            key = path.rsplit("/", 1)[1]
            if key not in self.blobs:
                return 404, {}, b""
            return 200, {"Docker-Content-Digest": key, "Content-Length": str(len(self.blobs[key]))}, b""
        if method == "GET" and "/blobs/sha256:" in path:
            return 200, {}, self.blobs[path.rsplit("/", 1)[1]]
        if method == "POST":
            identity = str(len(self.uploads) + 1)
            self.uploads[identity] = bytearray()
            return 202, {"Location": registry.ORIGIN + registry.BASE + "/blobs/uploads/" + identity}, b""
        if "/blobs/uploads/" in path:
            identity = path.rsplit("/", 1)[1]
            value = self.uploads[identity]
            if method == "PATCH":
                if headers["Content-Range"] != f"{len(value)}-{len(value) + len(body) - 1}":
                    raise AssertionError("noncontiguous layer bytes")
                self.patch_bytes.append(bytes(body))
                value.extend(body)
                if self.fail_after_patch and len(self.patch_bytes) == 2:
                    self.fail_after_patch = False
                    raise registry.RegistryError("lost PATCH response")
            if method in {"GET", "PATCH"}:
                return (
                    (204 if method == "GET" else 202),
                    {"Location": registry.ORIGIN + path, "Range": f"0-{max(0, len(value) - 1)}"},
                    b"",
                )
            if method == "PUT":
                key = urllib.parse.parse_qs(parsed.query)["digest"][0]
                if sha(value) != key:
                    raise AssertionError("final layer SHA differs")
                self.blobs[key] = bytes(value)
                return 201, {"Docker-Content-Digest": key}, b""
        if method == "PUT" and "/manifests/" in path:
            reference = path.rsplit("/", 1)[1]
            self.tags[reference] = (sha(body), json.loads(body))
            self.manifest_puts.append(reference)
            if self.fail_after_manifest:
                self.fail_after_manifest = False
                raise registry.RegistryError("lost manifest response")
            return 201, {}, b""
        raise AssertionError("Unexpected registry request: " + method + " " + path)


class RegistryPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.archive = self.root / "image.tar.gz"
        self.config, self.layer = make_archive(self.archive)
        self.state = self.root / "state"

    def plan(self):
        return registry.prepare_archive(self.archive, self.state, VERSION, REVISION)

    def test_offline_layout_reuses_existing_gzip_and_exact_config_without_reextracting(self):
        plan = self.plan()
        self.assertEqual(plan["config"]["digest"], sha(self.config))
        self.assertEqual(plan["blobs"][1]["digest"], sha(self.layer))
        self.assertEqual(registry.blob_path(Path(plan["layout_directory"]), sha(self.layer)).read_bytes(), self.layer)
        with patch.object(registry.tarfile, "open", side_effect=AssertionError("must reuse OCI")):
            self.assertEqual(self.plan(), plan)
        self.assertEqual((self.state / "prepared.json").stat().st_mode & 0o777, 0o600)

    def test_corrupt_blob_and_wrong_platform_revision_or_compression_are_rejected(self):
        with self.assertRaisesRegex(registry.RegistryError, "version/revision"):
            registry.prepare_archive(self.archive, self.root / "wrong", VERSION, "b" * 40)
        make_archive(self.archive, corrupt=True)
        with self.assertRaisesRegex(registry.RegistryError, "SHA256 mismatch"):
            registry.prepare_archive(self.archive, self.root / "corrupt", VERSION, REVISION)
        make_archive(self.archive, compression="application/vnd.oci.image.layer.v1.tar")
        with self.assertRaisesRegex(registry.RegistryError, "existing gzip"):
            registry.prepare_archive(self.archive, self.root / "raw", VERSION, REVISION)

    def test_safe_publication_reuses_blobs_and_preserves_all_unknown_existing_version_tags(self):
        plan, client = self.plan(), MemoryRegistry()
        publisher = registry.Publisher(plan, self.state, client)
        path = publisher.publish()
        receipt = json.loads(path.read_text())
        self.assertEqual(receipt["status"], "verified")
        self.assertFalse(receipt["latest_updated"])
        self.assertEqual(client.manifest_puts, [VERSION + "-arm64", VERSION])
        self.assertEqual(client.tags[VERSION][1]["manifests"][0]["platform"], {"os": "linux", "architecture": "arm64"})
        transferred = len(client.patch_bytes)
        registry.Publisher(plan, self.state, client).publish()
        self.assertEqual(len(client.patch_bytes), transferred)
        self.assertEqual(client.manifest_puts, [VERSION + "-arm64", VERSION])
        fresh = self.root / "unknown-state"
        with self.assertRaisesRegex(registry.RegistryError, "Unknown or conflicting"):
            registry.Publisher(plan, fresh, client).publish()
        self.assertNotEqual(json.loads((fresh / "registry-receipt.json").read_text())["status"], "verified")

    def test_unknown_chunk_result_resumes_at_remote_offset_without_resending_accepted_bytes(self):
        make_archive(self.archive, large=True)
        plan, client = self.plan(), MemoryRegistry()
        client.fail_after_patch = True
        with self.assertRaisesRegex(registry.RegistryError, "lost PATCH"):
            registry.Publisher(plan, self.state, client).publish()
        previous = list(client.patch_bytes)
        registry.Publisher(plan, self.state, client).publish()
        self.assertEqual(client.patch_bytes[: len(previous)], previous)
        self.assertTrue(all(len(body) <= registry.CHUNK for body in client.patch_bytes))
        self.assertEqual(
            sum(len(body) for body in client.patch_bytes),
            len(self.config) + len(gzip.compress(random.Random(7).randbytes(registry.CHUNK + 101), mtime=0)),
        )

    def test_manifest_response_loss_reconciles_intent_and_latest_requires_published_matching_release(self):
        plan, client = self.plan(), MemoryRegistry()
        client.fail_after_manifest = True
        with self.assertRaisesRegex(registry.RegistryError, "lost manifest"):
            registry.Publisher(plan, self.state, client).publish()
        registry.Publisher(plan, self.state, client).publish()
        self.assertEqual(client.manifest_puts.count(VERSION + "-arm64"), 1)
        with self.assertRaisesRegex(registry.RegistryError, "matching published"):
            registry.Publisher(plan, self.state, client).publish(update_latest=True, release={"draft": True})
        self.assertNotIn("latest", client.tags)
        release = {"tag_name": "v" + VERSION, "draft": False, "prerelease": False, "target_commitish": REVISION}
        registry.Publisher(plan, self.state, client).publish(update_latest=True, release=release)
        self.assertEqual(client.tags["latest"][0], plan["index"]["digest"])
        count = client.manifest_puts.count("latest")
        registry.Publisher(plan, self.state, client).publish(update_latest=True, release=release)
        self.assertEqual(client.manifest_puts.count("latest"), count)


class RegistryTransportTests(unittest.TestCase):
    def test_basic_is_used_verbatim_only_for_token_and_bearer_only_for_registry(self):
        calls = []

        class Response(io.BytesIO):
            status = 200
            headers = {}

        class Opener:
            def open(self, request, timeout):
                calls.append(request)
                return Response(b'{"token":"MEMORY-ONLY-JWT"}' if "/v2/token?" in request.full_url else b"{}")

        client = registry.Client("already-encoded-placeholder", opener=Opener())
        client.request("GET", registry.BASE + "/manifests/test")
        self.assertEqual(calls[0].get_header("Authorization"), "Basic already-encoded-placeholder")
        self.assertEqual(calls[1].get_header("Authorization"), "Bearer MEMORY-ONLY-JWT")
        for target in ("http://git.cellnucle.us/v2/x", "https://other.example/v2/x", "/api/v1/user", "/v2/../token"):
            with self.subTest(target=target), self.assertRaises(registry.RegistryError):
                client.request("GET", target)
        self.assertEqual(len(calls), 2)
        with self.assertRaisesRegex(registry.RegistryError, "credentials"):
            client.location(registry.ORIGIN + registry.BASE + "/blobs/uploads/id?token=MEMORY-ONLY-JWT")

    def test_error_response_and_receipt_never_expose_authentication_values(self):
        class Opener:
            def open(self, request, timeout):
                raise urllib.error.HTTPError(
                    request.full_url, 401, "MEMORY-ONLY-SECRET", {}, io.BytesIO(b"secret echo")
                )

        with self.assertRaises(registry.RegistryError) as failure:
            registry.Client("MEMORY-ONLY-SECRET", opener=Opener()).authenticate()
        self.assertNotIn("MEMORY-ONLY-SECRET", str(failure.exception))
        self.assertNotIn("secret echo", str(failure.exception))
