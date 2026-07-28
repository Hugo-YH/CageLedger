import io
import tempfile
import unittest
from pathlib import Path

from server_app.static import send_documentation_asset


class StaticHandler:
    def __init__(self, path):
        self.path = path
        self.headers = {}
        self.body = io.BytesIO()
        self.wfile = self.body
        self.status = None
        self.response_headers = {}

    def send_response(self, status):
        self.status = status

    def send_header(self, key, value):
        self.response_headers[key] = value

    def end_headers(self):
        return None


class DocumentationStaticTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        docs = self.root / "docs" / "guide"
        docs.mkdir(parents=True)
        (self.root / "docs" / "index.html").write_text("documentation home", encoding="utf-8")
        (docs / "getting-started.html").write_text("getting started", encoding="utf-8")
        (self.root / "docs" / "asset.js").write_text("export {};", encoding="utf-8")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_serves_docs_home(self):
        handler = StaticHandler("/docs/")

        self.assertTrue(send_documentation_asset(handler, self.root))
        self.assertEqual(handler.status, 200)
        self.assertEqual(handler.body.getvalue(), b"documentation home")

    def test_resolves_clean_url_to_generated_html(self):
        handler = StaticHandler("/docs/guide/getting-started")

        self.assertTrue(send_documentation_asset(handler, self.root))
        self.assertEqual(handler.status, 200)
        self.assertEqual(handler.body.getvalue(), b"getting started")

    def test_ignores_non_documentation_paths(self):
        handler = StaticHandler("/app")

        self.assertFalse(send_documentation_asset(handler, self.root))

    def test_does_not_treat_app_entry_as_a_documentation_asset(self):
        handler = StaticHandler("/docs/app")

        self.assertFalse(send_documentation_asset(handler, self.root))


if __name__ == "__main__":
    unittest.main()
