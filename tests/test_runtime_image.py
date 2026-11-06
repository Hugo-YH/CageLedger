import gzip
import hashlib
import io
import shutil
import signal
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import cloud_registry as registry
import runtime_image as runtime

from tests.test_cloud_registry import MemoryRegistry


class RuntimeImageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / "repo"
        (self.repo / "scripts").mkdir(parents=True)
        (self.repo / "Dockerfile").write_text(
            "ARG PYTHON_IMAGE=python@sha256:" + "1" * 64 + "\n"
            "FROM ${PYTHON_IMAGE} AS runtime-deps\nRUN install dependencies\n"
            "FROM ${RUNTIME_IMAGE} AS runtime\nCOPY server.py ./\n"
        )
        for name in (
            "requirements.txt",
            "requirements-runtime.txt",
            "scripts/with_build_ca.sh",
            "scripts/retry_command.sh",
        ):
            (self.repo / name).write_text("frozen dependencies\n")
        self.layout = self.root / "export"
        self.layout.mkdir()
        original = b"a small, synthetic runtime filesystem"
        layer = {**registry.store_bytes(self.layout, gzip.compress(original, mtime=0)), "mediaType": registry.LAYER}
        config = {
            "os": "linux",
            "architecture": "arm64",
            "config": {"Labels": {runtime.LABEL: runtime.fingerprint(self.repo)}, "Env": ["PATH=/bin"]},
            "rootfs": {"type": "layers", "diff_ids": ["sha256:" + hashlib.sha256(original).hexdigest()]},
        }
        config_item = {**registry.store_bytes(self.layout, registry.encoded(config)), "mediaType": registry.CONFIG}
        manifest = {"schemaVersion": 2, "mediaType": registry.IMAGE, "config": config_item, "layers": [layer]}
        manifest_item = {**registry.store_bytes(self.layout, registry.encoded(manifest)), "mediaType": registry.IMAGE}
        (self.layout / "index.json").write_bytes(registry.encoded({"schemaVersion": 2, "manifests": [manifest_item]}))
        self.lock = runtime.lock_export(self.repo, self.layout)
        registry.save(self.repo / runtime.LOCK, self.lock)

    def test_only_dependency_inputs_change_the_pin_and_drift_cannot_silently_rebuild(self):
        expected = runtime.load_lock(self.repo)
        (self.repo / "server.py").write_text("a business-only update")
        with (self.repo / "Dockerfile").open("a") as out:
            out.write("ENV CAGELEDGER_APP_VERSION=next\n")
        self.assertEqual(runtime.load_lock(self.repo), expected)
        (self.repo / "requirements.txt").write_text("new dependency")
        with self.assertRaisesRegex(registry.RegistryError, "dependencies changed"):
            runtime.load_lock(self.repo)

    def test_cold_cache_downloads_exact_blobs_once_and_corruption_is_rejected(self):
        owner = self
        requests = []

        class Reader:
            def request(self, method, path, *, headers):
                requests.append(path)
                owner.assertEqual(method, "GET")
                owner.assertIn("/manifests/", path)
                value = path.rsplit("/", 1)[1]
                return 200, {}, registry.blob_path(owner.layout, value).read_bytes()

            def open_blob(self, value, *, offset):
                requests.append(value)
                owner.assertEqual(offset, 0)
                body = registry.blob_path(owner.layout, value).read_bytes()
                response = io.BytesIO(body)
                response.status = 200
                response.headers = {"Content-Length": str(len(body))}
                return response

        state = self.root / "cache"
        layout = runtime.ensure_layout(self.repo, self.lock, state=state, client=Reader())
        self.assertEqual(len(requests), 3)
        runtime.ensure_layout(self.repo, self.lock, state=state, client=Reader())
        self.assertEqual(len(requests), 3)
        registry.blob_path(layout, self.lock["layers"][0]["digest"]).write_bytes(b"corrupt")
        with self.assertRaisesRegex(registry.RegistryError, "bytes/size mismatch"):
            runtime.ensure_layout(self.repo, self.lock, state=state, client=Reader())
        self.assertEqual(len(requests), 3)

    def test_runtime_stream_resumes_or_compares_prefix_when_registry_ignores_ranges(self):
        body = b"0123456789abcdefghijklmnopqrstuvwxyz"
        item = {"digest": "sha256:" + hashlib.sha256(body).hexdigest(), "size": len(body)}
        for supports_range in (True, False):
            with self.subTest(supports_range=supports_range):
                destination = self.root / str(supports_range) / "blob"
                offsets, read_sizes = [], []

                class Reader:
                    fail = True
                    transferred = 0

                    def __init__(self, support, offsets, sizes):
                        self.support, self.offsets, self.sizes = support, offsets, sizes

                    def open_blob(self, value, *, offset):
                        self.offsets.append(offset)
                        owner = self
                        resumed = self.support and offset > 0

                        class Response(io.BytesIO):
                            def read(self, size):
                                owner.sizes.append(size)
                                if self.tell() >= 8 and owner.fail:
                                    owner.fail = False
                                    raise registry.RegistryError("connection lost")
                                value = super().read(size)
                                owner.transferred += len(value)
                                return value

                        response = Response(body[offset:] if resumed else body)
                        response.status = 206 if resumed else 200
                        response.headers = (
                            {"Content-Range": f"bytes {offset}-{len(body) - 1}/{len(body)}"} if resumed else {}
                        )
                        return response

                reader = Reader(supports_range, offsets, read_sizes)
                with patch.object(runtime, "CHUNK", 8):
                    with self.assertRaisesRegex(registry.RegistryError, "connection lost"):
                        runtime.download_blob(reader, item, destination)
                    runtime.download_blob(reader, item, destination)
                self.assertEqual(destination.read_bytes(), body)
                self.assertEqual(offsets, [0, 8])
                self.assertTrue(all(0 < n <= 8 for n in read_sizes))
                self.assertEqual(reader.transferred, len(body) + (0 if supports_range else 8))
                self.assertFalse(destination.with_suffix(".partial").exists())

        class WrongRange:
            def open_blob(self, *args, **kwargs):
                response = io.BytesIO(body)
                response.status = 206
                response.headers = {"Content-Range": "bytes 5-35/36"}
                return response

        with self.assertRaisesRegex(registry.RegistryError, "resume range differs"):
            runtime.download_blob(WrongRange(), item, self.root / "bad-download")

    def test_runtime_publication_reuses_existing_layer_and_never_moves_application_tags(self):
        client = MemoryRegistry()
        layer = self.lock["layers"][0]
        client.blobs[layer["digest"]] = registry.blob_path(self.layout, layer["digest"]).read_bytes()
        state = self.root / "publication"
        runtime.publish_runtime(self.repo, self.lock, self.layout, client, state)
        self.assertEqual(client.manifest_puts, [self.lock["tag"]])
        transferred = len(client.patch_bytes)
        runtime.publish_runtime(self.repo, self.lock, self.layout, client, state)
        self.assertEqual(len(client.patch_bytes), transferred)
        self.assertNotIn("latest", client.tags)
        self.assertEqual(runtime.load_lock(self.repo), self.lock)
        client.tags[self.lock["tag"]] = ("sha256:" + "f" * 64, {})
        with self.assertRaisesRegex(registry.RegistryError, "Conflicting runtime tag"):
            runtime.publish_runtime(self.repo, self.lock, self.layout, client, state)
        self.assertEqual(len(client.patch_bytes), transferred)

    def test_interrupted_export_does_not_reuse_partial_index_or_existing_log(self):
        job = self.root / "refresh-job"
        (job / "oci").mkdir(parents=True)
        shutil.copyfile(self.layout / "index.json", job / "oci/index.json")
        (job / "build.log").write_text("interrupted build")
        calls = []

        def run(command, log, *, env):
            self.assertFalse(log.exists())
            log.write_text("completed")
            calls.append(command)
            shutil.copytree(self.layout, job / "oci")

        runner = SimpleNamespace(run=run)
        self.assertEqual(runtime.build_export(self.repo, job, runner, ["build"], {}), self.lock)
        self.assertEqual(runtime.build_export(self.repo, job, runner, ["build"], {}), self.lock)
        self.assertEqual(calls, [["build"]])
        self.assertEqual((job / "build.log").read_text(), "interrupted build")
        self.assertEqual(len(list(job.glob("incomplete-oci-*"))), 1)
        registry.blob_path(job / "oci", self.lock["layers"][0]["digest"]).write_bytes(b"modified")
        with self.assertRaises(registry.RegistryError):
            runtime.build_export(self.repo, job, runner, ["build"], {})
        self.assertEqual(calls, [["build"]])

    def test_cancellation_restores_signal_handlers_before_any_publication(self):
        before = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
        runner = SimpleNamespace(stopping=threading.Event())
        with self.assertRaisesRegex(registry.RegistryError, "cancelled before publication"):
            with runtime.runner_signals(runner):
                signal.raise_signal(signal.SIGINT)
        self.assertTrue(runner.stopping.is_set())
        self.assertEqual({sig: signal.getsignal(sig) for sig in before}, before)
