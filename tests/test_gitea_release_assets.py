import ast
import hashlib
import io
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import gitea_release_assets as assets


class Response(io.BytesIO):
    status = 200


class ReleaseTransportTests(unittest.TestCase):
    def metadata(self, body=b"permission probe"):
        return {
            "id": 1,
            "name": "probe.txt",
            "size": len(body),
            "browser_download_url": assets.ORIGIN + "/hugo/cageledger/releases/download/dev/probe.txt",
        }

    def test_same_https_origin_and_no_redirects(self):
        for url in (
            "http://git.cellnucle.us/file",
            "https://other.example/file",
            "https://user:secret@git.cellnucle.us/file",
        ):
            with self.subTest(url=url), self.assertRaises(assets.AssetError):
                assets.checked_url(url)
        self.assertEqual(assets.checked_url("/api/v1/user"), assets.ORIGIN + "/api/v1/user")
        self.assertIsNone(assets.NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://other.example"))

    def test_multipart_framing_and_upload_are_bounded_streams_with_full_content_length(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "archive.part0001.gz"
            content = b"binary-piece" * 20000
            path.write_bytes(content)
            with assets.MultipartFile(path, "fixed-boundary") as stream:
                chunks = []
                while chunk := stream.read():
                    self.assertLessEqual(len(chunk), assets.BLOCK)
                    chunks.append(chunk)
                combined = b"".join(chunks)
                self.assertEqual(len(combined), stream.size)
                self.assertIn(b'filename="archive.part0001.gz"', combined)
                self.assertIn(b"\r\n\r\n" + content + b"\r\n--fixed-boundary--\r\n", combined)
            observed = {}
            owner = self

            class Opener:
                def open(self, request, timeout):
                    owner.assertIsInstance(request.data, assets.MultipartFile)
                    observed["length"] = int(request.get_header("Content-length"))
                    observed["auth"] = request.get_header("Authorization")
                    observed["method"] = request.get_method()
                    observed["body"] = 0
                    while chunk := request.data.read(8192):
                        owner.assertLessEqual(len(chunk), 8192)
                        observed["body"] += len(chunk)
                    value = {
                        "id": 5,
                        "name": path.name,
                        "size": len(content),
                        "browser_download_url": assets.ORIGIN + "/attachments/uuid",
                    }
                    return Response(json.dumps(value).encode())

            client = assets.ReleaseAssets("test-binding", opener=Opener())
            client.upload(19, SimpleNamespace(path=path))
            self.assertEqual(observed["length"], observed["body"])
            self.assertEqual(observed["auth"], "token test-binding")
            self.assertEqual(observed["method"], "POST")

    def test_anonymous_probe_checks_raw_url_without_authorization_and_rejects_200(self):
        requests = []

        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                return Response(b"public probe content")

        client = assets.ReleaseAssets("test-binding", anonymous_opener=Opener())
        with self.assertRaisesRegex(assets.AssetError, "anonymously accessible"):
            client.anonymous_denied(self.metadata())
        self.assertEqual(requests[0].full_url, self.metadata()["browser_download_url"])
        self.assertFalse(requests[0].has_header("Authorization"))

    def test_only_denied_status_or_same_origin_login_redirect_is_private(self):
        class Opener:
            def __init__(self, code, location=None):
                self.code, self.location = code, location

            def open(self, request, timeout):
                raise urllib.error.HTTPError(
                    request.full_url,
                    self.code,
                    "secret-response",
                    {"Location": self.location} if self.location else {},
                    io.BytesIO(b"secret-response-body"),
                )

        for code, location in ((401, None), (403, None), (404, None), (302, "/user/login?redirect_to=private")):
            with (
                self.subTest(code=code),
                patch.object(assets.ReleaseAssets("test-binding"), "anonymous_opener", Opener(code, location)),
            ):
                result = assets.ReleaseAssets("test-binding", anonymous_opener=Opener(code, location)).anonymous_denied(
                    self.metadata()
                )
                self.assertEqual(result["status"], code)
        for code, location in ((500, None), (302, "https://other.example/user/login"), (302, "/attachments/public")):
            with self.subTest(code=code, location=location), self.assertRaises(assets.AssetError) as error:
                assets.ReleaseAssets("test-binding", anonymous_opener=Opener(code, location)).anonymous_denied(
                    self.metadata()
                )
            self.assertNotIn("secret-response", str(error.exception))

    def test_authenticated_download_hashes_complete_bytes_without_server_sha(self):
        body = b"downloaded attachment" * 10000

        class Opener:
            def open(self, request, timeout):
                return Response(body)

        client = assets.ReleaseAssets("test-binding", opener=Opener())
        metadata = self.metadata(body)
        self.assertEqual(client.digest(metadata), hashlib.sha256(body).hexdigest())
        expected = SimpleNamespace(path=Path("probe.txt"), size=len(body), sha256="b" * 64)
        with self.assertRaisesRegex(assets.AssetError, "SHA256 conflict"):
            client.verify(metadata, expected)
        wrong = {**metadata, "size": len(body) + 1}
        with self.assertRaisesRegex(assets.AssetError, "incomplete"):
            client.digest(wrong)


class DownloadHelperTests(unittest.TestCase):
    def helper(self):
        script = assets.download_script("v1.2.3-dev.aaaaaaaaaaaa", "a" * 40, "manifest.json", "b" * 64)
        namespace = {"__name__": "cageledger_download_test"}
        exec(compile(script, "CageLedger-download.py.txt", "exec"), namespace)
        return script, namespace

    def test_generated_standard_library_helper_downloads_then_restores_ordered_chunks(self):
        script, helper = self.helper()
        ast.parse(script, feature_version=(3, 9))
        self.assertIn(b"getpass.getpass", script)
        self.assertNotIn(b"test-binding", script)
        body = b"0123456789" * 100
        metadata = {"name": "archive.tar.part0001.gz", "size": len(body), "sha256": hashlib.sha256(body).hexdigest()}
        asset = {**metadata, "browser_download_url": assets.ORIGIN + "/attachments/chunk"}
        requests = []

        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                return Response(body)

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            first = helper["download"](asset, metadata, directory, Opener(), "test-binding")
            second_name = "archive.tar.part0002.gz"
            second = directory / second_name
            second.write_bytes(b"second binary piece")
            second_metadata = {
                "name": second_name,
                "size": second.stat().st_size,
                "sha256": helper["file_hash"](second),
            }
            combined = body + second.read_bytes()
            record = {
                "name": "archive.tar.gz",
                "size": len(combined),
                "sha256": hashlib.sha256(combined).hexdigest(),
                "attachments": [metadata, second_metadata],
            }
            helper["restore"](record, directory)
            self.assertEqual((directory / record["name"]).read_bytes(), combined)
            self.assertEqual(first.read_bytes(), body)
            (directory / record["name"]).write_bytes(b"unrelated existing archive")
            with self.assertRaisesRegex(RuntimeError, "Existing file differs"):
                helper["restore"](record, directory)
        self.assertEqual(requests[0].get_header("Authorization"), "token test-binding")

    def test_generated_helper_rejects_cross_origin_and_mismatched_existing_download(self):
        _, helper = self.helper()
        with self.assertRaises(RuntimeError):
            helper["safe_url"]("https://other.example/attachment")
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "file.gz"
            path.write_bytes(b"different")
            with self.assertRaisesRegex(RuntimeError, "Existing file differs"):
                helper["existing"](path, 9, "a" * 64)
