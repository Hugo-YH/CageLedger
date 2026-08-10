import gzip
import io
import tempfile
import unittest
from pathlib import Path

from server_app.static import _send_static_file


class _StaticHandler:
    def __init__(self):
        self.headers = {"Accept-Encoding": "gzip"}
        self.response_status = None
        self.response_headers = {}
        self.wfile = io.BytesIO()

    def send_response(self, status):
        self.response_status = status

    def send_header(self, key, value):
        self.response_headers[key] = value

    def end_headers(self):
        return None


class StaticAssetTests(unittest.TestCase):
    def test_uses_fresh_precompressed_asset_for_gzip_clients(self):
        raw = b"CageLedger static asset" * 200
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "bundle.js"
            target.write_bytes(raw)
            precompressed = gzip.compress(raw, compresslevel=1)
            compressed_target = target.with_name(f"{target.name}.gz")
            compressed_target.write_bytes(precompressed)

            handler = _StaticHandler()
            self.assertTrue(_send_static_file(handler, target))

        self.assertEqual(handler.response_headers["Content-Encoding"], "gzip")
        self.assertEqual(handler.wfile.getvalue(), precompressed)
        self.assertEqual(gzip.decompress(handler.wfile.getvalue()), raw)


if __name__ == "__main__":
    unittest.main()
