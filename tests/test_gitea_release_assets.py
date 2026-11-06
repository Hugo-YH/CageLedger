import ast
import hashlib
import io
import json
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
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
            observed = {"lookups": 0, "posts": 0, "downloads": []}
            owner = self
            prefix = assets.ORIGIN + "/hugo/cageledger/releases/download/v1.2.3/"

            class Opener:
                def open(self, request, timeout):
                    if request.get_method() == "GET":
                        if request.full_url == assets.ORIGIN + assets.API + "/releases/19":
                            observed["lookups"] += 1
                            return Response(b'{"id":19,"tag_name":"v1.2.3"}')
                        owner.assertTrue(request.full_url.startswith(prefix))
                        observed["downloads"].append(request.full_url)
                        return Response(content)
                    observed["posts"] += 1
                    owner.assertIsInstance(request.data, assets.MultipartFile)
                    observed["length"] = int(request.get_header("Content-length"))
                    observed["auth"] = request.get_header("Authorization")
                    observed["body"] = 0
                    while chunk := request.data.read(8192):
                        owner.assertLessEqual(len(chunk), 8192)
                        observed["body"] += len(chunk)
                    name = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)["name"][0]
                    identity = "9a3f4fa1-c1d2-4e33-8e44-" + f"{observed['posts']:012x}"
                    value = {
                        "id": observed["posts"] + 4,
                        "uuid": identity,
                        "name": name,
                        "size": len(content),
                        "created_at": "2026-11-06T01:02:03Z",
                        "browser_download_url": assets.ORIGIN + "/attachments/" + identity,
                    }
                    if observed["posts"] == 2:
                        value["browser_download_url"] = prefix + urllib.parse.quote(name, safe="")
                    return Response(json.dumps(value).encode())

            client = assets.ReleaseAssets("test-binding", opener=Opener())
            second = path.with_name("second piece.part0001.gz")
            second.write_bytes(content)
            results = []
            for source in (path, second):
                artifact = SimpleNamespace(path=source, size=len(content), sha256=hashlib.sha256(content).hexdigest())
                result = client.upload(19, artifact)
                client.verify(result, artifact)
                results.append(result)
            expected = [prefix + path.name, prefix + "second%20piece.part0001.gz"]
            self.assertEqual([item["browser_download_url"] for item in results], expected)
            self.assertEqual(observed["downloads"], expected)
            self.assertEqual((observed["lookups"], observed["posts"]), (1, 2))
            self.assertEqual(results[1]["id"], 6)
            self.assertEqual(results[1]["uuid"], "9a3f4fa1-c1d2-4e33-8e44-000000000002")
            self.assertEqual(results[1]["created_at"], "2026-11-06T01:02:03Z")
            self.assertEqual(observed["length"], observed["body"])
            self.assertEqual(observed["auth"], "token test-binding")

    def test_uploaded_alias_rejects_unknown_url_wrong_uuid_and_changed_size(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "image.part0001.gz"
            path.write_bytes(b"original image piece")
            metadata = {
                "id": 5,
                "uuid": "9a3f4fa1-c1d2-4e33-8e44-123456789abc",
                "name": path.name,
                "size": path.stat().st_size,
                "created_at": "2026-11-06T01:02:03Z",
                "browser_download_url": assets.ORIGIN + "/attachments/9a3f4fa1-c1d2-4e33-8e44-123456789abc",
            }
            cases = {
                "unknown URL": {"browser_download_url": assets.ORIGIN + "/attachments/unexpected"},
                "other origin": {"browser_download_url": "https://other.example/private-image"},
                "wrong UUID": {"uuid": "11111111-2222-4333-8444-555555555555"},
                "changed size": {"size": path.stat().st_size + 1},
            }
            for label, change in cases.items():
                events = []

                class Opener:
                    def __init__(self, updated, requests):
                        self.updated, self.requests = updated, requests

                    def open(self, request, timeout):
                        self.requests.append((request.get_method(), request.full_url))
                        value = self.updated if request.get_method() == "POST" else {"id": 19, "tag_name": "v1.2.3"}
                        return Response(json.dumps(value).encode())

                with self.subTest(case=label), self.assertRaises(assets.AssetError):
                    assets.ReleaseAssets("test-binding", opener=Opener({**metadata, **change}, events)).upload(
                        19, SimpleNamespace(path=path)
                    )
                self.assertEqual(events[0][0], "POST")
                self.assertTrue(
                    all(
                        method == "POST" or url == assets.ORIGIN + assets.API + "/releases/19" for method, url in events
                    )
                )

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
