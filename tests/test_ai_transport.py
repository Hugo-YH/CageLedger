import io
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from server_app.services import ai


class AiTransportTests(unittest.TestCase):
    def test_redirects_never_send_credentials_to_target(self):
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                requests.append(("post", self.path))
                self.send_response(302)
                self.send_header("Location", redirect_url[0])
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_GET(self):
                requests.append(("get", self.path))
                self.send_response(200)
                self.end_headers()

            def log_message(self, *args):
                pass

        source = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        target = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (source, target)]
        for thread in threads:
            thread.start()
        try:
            source_url = f"http://127.0.0.1:{source.server_port}/api"
            redirect_url = [f"http://127.0.0.1:{target.server_port}/destination"]
            with patch.object(ai, "DEEPSEEK_API_KEY", "test-only"), patch.object(ai, "DEEPSEEK_API_URL", source_url):
                for location in (redirect_url[0], source_url + "/same-origin"):
                    redirect_url[0] = location
                    with self.assertRaisesRegex(ValueError, "重定向"):
                        ai.deepseek_chat_json("rules", "text")
            self.assertEqual(requests, [("post", "/api"), ("post", "/api")])
        finally:
            for server in (source, target):
                server.shutdown()
                server.server_close()
            for thread in threads:
                thread.join()

    def test_oversized_success_and_error_are_bounded_and_closed(self):
        for status in (200, 400):
            with self.subTest(status=status):
                stream = io.BytesIO(b"x" * (ai._MAX_RESPONSE_BYTES + 10))
                with patch.object(ai, "DEEPSEEK_API_KEY", "test-only"):
                    if status == 200:
                        opener = patch.object(ai, "urlopen", return_value=stream)
                    else:
                        error = HTTPError("http://example.invalid", status, "error", {}, stream)
                        opener = patch.object(ai, "urlopen", side_effect=error)
                    with opener, self.assertRaisesRegex(ValueError, "响应过大"):
                        ai.deepseek_chat_json("rules", "text")
                self.assertTrue(stream.closed)

    def test_normal_response_and_bounded_error_preserve_messages(self):
        payload = {"choices": [{"message": {"content": '{"ok": true}'}}], "usage": {"total_tokens": 3}}
        stream = io.BytesIO(json.dumps(payload).encode())
        with patch.object(ai, "DEEPSEEK_API_KEY", "test-only"), patch.object(ai, "urlopen", return_value=stream):
            self.assertEqual(ai.deepseek_chat_json("rules", "text"), ({"ok": True}, {"total_tokens": 3}))
        self.assertTrue(stream.closed)
        stream = io.BytesIO(b"upstream detail")
        error = HTTPError("http://example.invalid", 400, "error", {}, stream)
        with patch.object(ai, "DEEPSEEK_API_KEY", "test-only"), patch.object(ai, "urlopen", side_effect=error):
            with self.assertRaisesRegex(ValueError, "HTTP 400 upstream detail"):
                ai.deepseek_chat_json("rules", "text")
        self.assertTrue(stream.closed)

    def test_large_valid_response_below_limit_is_accepted(self):
        payload = {"choices": [{"message": {"content": '{"ok": true}'}}], "padding": "x" * (2 * 1024 * 1024)}
        stream = io.BytesIO(json.dumps(payload).encode())
        with patch.object(ai, "DEEPSEEK_API_KEY", "test-only"), patch.object(ai, "urlopen", return_value=stream):
            self.assertEqual(ai.deepseek_chat_json("rules", "text"), ({"ok": True}, {}))
        self.assertTrue(stream.closed)

    def test_upstream_error_scrubs_key_url_and_bearer_before_truncation(self):
        key = "test-secret-only"
        url = "https://example.invalid/private/api"
        detail = ("x" * 290) + f" {key} {url} {url.replace('/', r'\/')} Bearer another-secret"
        stream = io.BytesIO(detail.encode())
        error = HTTPError(url, 400, "error", {}, stream)
        with (
            patch.object(ai, "DEEPSEEK_API_KEY", key),
            patch.object(ai, "DEEPSEEK_API_URL", url),
            patch.object(ai, "urlopen", side_effect=error),
            self.assertRaises(ValueError) as caught,
        ):
            ai.deepseek_chat_json("rules", "text")
        text = str(caught.exception)
        self.assertIn("HTTP 400", text)
        self.assertNotIn(key, text)
        self.assertNotIn("test-secr", text)
        self.assertNotIn(url, text)
        self.assertNotIn("another-secret", text)
        self.assertIs(caught.exception.__cause__, error)
        self.assertTrue(stream.closed)

        for echoed in (f"{url} {key} Bearer another-secret", url.replace("/", "\\/")):
            stream = io.BytesIO(echoed.encode())
            error = HTTPError(url, 400, "error", {}, stream)
            with (
                patch.object(ai, "DEEPSEEK_API_KEY", key),
                patch.object(ai, "DEEPSEEK_API_URL", url),
                patch.object(ai, "urlopen", side_effect=error),
                self.assertRaises(ValueError) as caught,
            ):
                ai.deepseek_chat_json("rules", "text")
            self.assertNotIn(key, str(caught.exception))
            self.assertNotIn(url, str(caught.exception))
            self.assertNotIn("example.invalid", str(caught.exception))
            self.assertNotIn("another-secret", str(caught.exception))

    def test_connection_error_hides_reason_and_preserves_cause(self):
        error = URLError("/private/internal/location")
        with (
            patch.object(ai, "DEEPSEEK_API_KEY", "test-only"),
            patch.object(ai, "urlopen", side_effect=error),
            self.assertRaises(ValueError) as caught,
        ):
            ai.deepseek_chat_json("rules", "text")
        self.assertIn("无法连接 DeepSeek", str(caught.exception))
        self.assertNotIn("/private/internal/location", str(caught.exception))
        self.assertIs(caught.exception.__cause__, error)

    def test_invalid_outer_responses_are_safe_and_usage_is_a_dict(self):
        invalid = [
            [],
            None,
            {},
            {"choices": []},
            {"choices": [None]},
            {"choices": [{"message": []}]},
            {"choices": [{"message": {"content": None}}]},
        ]
        for response in invalid:
            with self.subTest(response=response):
                stream = io.BytesIO(json.dumps(response).encode())
                with (
                    patch.object(ai, "DEEPSEEK_API_KEY", "test-only"),
                    patch.object(ai, "urlopen", return_value=stream),
                    self.assertRaisesRegex(ValueError, "响应无效"),
                ):
                    ai.deepseek_chat_json("rules", "text")
                self.assertTrue(stream.closed)
        for usage in ([], "invalid", 3, None):
            payload = {"choices": [{"message": {"content": '{"ok": true}'}}], "usage": usage}
            with (
                patch.object(ai, "DEEPSEEK_API_KEY", "test-only"),
                patch.object(ai, "urlopen", return_value=io.BytesIO(json.dumps(payload).encode())),
            ):
                self.assertEqual(ai.deepseek_chat_json("rules", "text"), ({"ok": True}, {}))


if __name__ == "__main__":
    unittest.main()
