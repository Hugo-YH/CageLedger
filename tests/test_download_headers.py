import io
import unittest
from http.server import BaseHTTPRequestHandler
from urllib.parse import quote

from server_app.web import handler as web_handler
from server_app.web.multipart import parse_multipart_upload


class HeaderRecorder(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self):
        self.wfile = io.BytesIO()
        self._headers_buffer = []
        self.request_version = "HTTP/1.1"
        self.command = "GET"

    def log_request(self, *args):
        pass


def response(filename, *, status=200):
    handler = HeaderRecorder()
    web_handler.send_download(handler, b"binary\x00", filename, "application/octet-stream", status=status)
    return handler.wfile.getvalue()


class DownloadHeaderTests(unittest.TestCase):
    def test_multipart_encoded_newlines_cannot_inject_response_headers(self):
        raw = (
            b'--b\r\nContent-Disposition: form-data; name="file"; '
            b"filename*=utf-8''a%0D%0AX-Injected%3A%20yes.png\r\n\r\nx\r\n--b--\r\n"
        )
        name, _ = parse_multipart_upload("multipart/form-data; boundary=b", raw)
        self.assertIn("\r\n", name)
        header, body = response(name).split(b"\r\n\r\n", 1)
        self.assertNotIn(b"\r\nX-Injected:", header)
        self.assertNotIn(b"%0D", header)
        self.assertNotIn(b"%0A", header)
        self.assertEqual(body, b"binary\x00")

    def test_normal_names_and_response_metadata(self):
        for name in ("report.pdf", "检疫报告.pdf", "a" * 200 + ".pdf"):
            with self.subTest(name=name):
                result = response(name, status=201)
                self.assertTrue(result.startswith(b"HTTP/1.1 201"))
                self.assertIn(b"Content-Type: application/octet-stream\r\n", result)
                self.assertIn(b"Content-Length: 7\r\n", result)
                self.assertIn(("filename*=UTF-8''" + quote(name, safe="")).encode(), result)
                self.assertTrue(result.endswith(b"binary\x00"))

    def test_untrusted_filenames_remain_single_bounded_ascii_header(self):
        for name in ('a"\\b.pdf', "", "🧬.中", "\x00\r\n", "🧬" * 10000):
            with self.subTest(name=name[:20]):
                result = response(name)
                header = result.split(b"\r\n\r\n", 1)[0]
                disposition = next(line for line in header.split(b"\r\n") if line.startswith(b"Content-Disposition:"))
                self.assertLess(len(disposition), 1000)
                self.assertNotIn(b"\\", disposition)
                disposition.decode("ascii")
                self.assertEqual(disposition.count(b'"'), 2)


if __name__ == "__main__":
    unittest.main()
