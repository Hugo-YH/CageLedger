import gzip
import http.client
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from server_app.static import STATIC_CACHE
from server_app.web.application import CageLedgerHandler


class _StaticOnlyHandler(CageLedgerHandler):
    pass


class StaticBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "index.html").write_text("<html><head></head><body>public app</body></html>")
        (self.root / "assets").mkdir()
        (self.root / "assets" / "app.js").write_text("public asset" * 200)
        (self.root / "assets" / "app.js.gz").write_bytes(gzip.compress(("public asset" * 200).encode()))
        for relative in (".env", "server.py", "private.txt", "data/database.sqlite", ".git/config"):
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("PRIVATE-CANARY")
        for target in ("server_app.web.read_routes.frontend_root", "server_app.web.handler.frontend_root"):
            self.patch = patch(target, return_value=self.root)
            self.patch.start()
            self.addCleanup(self.patch.stop)
        self.root_patch = patch("server_app.static.ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _StaticOnlyHandler)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.addCleanup(self.stop_server)
        STATIC_CACHE.clear()
        self.addCleanup(STATIC_CACHE.clear)

    def stop_server(self):
        self.server.shutdown()
        self.thread.join(2)
        self.server.server_close()

    def request(self, method, path, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_get_and_head_never_expose_checkout_or_private_files(self):
        for method in ("GET", "HEAD"):
            for path in (
                "/.env",
                "/%2eenv",
                "/server.py",
                "/private.txt",
                "/data/database.sqlite",
                "/.git/config",
                "/assets/../.env",
                "/assets/app.js.gz",
            ):
                with self.subTest(method=method, path=path):
                    status, _, body = self.request(method, path)
                    self.assertEqual(status, 404)
                    self.assertNotIn(b"PRIVATE-CANARY", body)

    def test_assets_gzip_spa_and_static_head_are_compatible(self):
        status, headers, body = self.request("GET", "/assets/app.js", {"Accept-Encoding": "gzip"})
        self.assertEqual(status, 200)
        self.assertEqual(gzip.decompress(body), ("public asset" * 200).encode())
        status, head, body = self.request("HEAD", "/assets/app.js", {"Accept-Encoding": "gzip"})
        self.assertEqual(status, 200)
        self.assertEqual(head["Content-Length"], headers["Content-Length"])
        self.assertEqual(body, b"")
        self.assertIn(b"public app", self.request("GET", "/app")[2])
        self.assertEqual(self.request("HEAD", "/app")[2], b"")

    def test_api_head_does_not_execute_get_side_effects(self):
        with patch("server_app.web.read_routes.API_ROUTER.handle") as handle:
            self.assertEqual(self.request("HEAD", "/api/reimbursement-ledger/obligations")[0], 404)
            handle.assert_not_called()


if __name__ == "__main__":
    unittest.main()
