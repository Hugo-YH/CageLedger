"""Gitea transport, retry safety and trust-boundary tests."""

import ssl
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

from server_app.domains.administration import system
from server_app.domains.feedback.gitea import Client, ConnectionSetupError, RemoteError
from tests.feedback_fixtures import REPOSITORY


class ClientTests(unittest.TestCase):
    def response(self, body=b"{}"):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = body
        return response

    def test_get_retries_transient_connection_and_response_timeouts(self):
        client = Client(REPOSITORY, "mock-token")
        for reason in (TimeoutError("read timed out"), ConnectionResetError("reset")):
            with (
                self.subTest(reason=type(reason).__name__),
                patch.object(
                    client.opener, "open", side_effect=[URLError(reason), self.response(b'{"number":1}')]
                ) as opened,
            ):
                self.assertEqual(client.request("GET", "/issues/1"), {"number": 1})
                self.assertEqual(opened.call_count, 2)

    def test_get_retries_are_bounded_and_do_not_leak_transport_details(self):
        client = Client(REPOSITORY, "mock-token")
        with (
            patch.object(
                client.opener, "open", side_effect=URLError(TimeoutError("sensitive transport detail"))
            ) as opened,
            self.assertRaises(RemoteError) as result,
        ):
            client.request("GET", "/issues/1")
        self.assertEqual(opened.call_count, 3)
        self.assertFalse(result.exception.uncertain)
        self.assertNotIn("sensitive", str(result.exception))

    def test_tls_handshake_timeout_before_post_is_retryable_not_uncertain(self):
        client = Client("https://example.test/hugo/cageledger", "mock-token")
        with (
            patch(
                "http.client.HTTPSConnection.connect", side_effect=TimeoutError("TLS handshake timed out")
            ) as connect,
            self.assertRaises(RemoteError) as result,
        ):
            client.request("POST", "/issues", {"title": "test"})
        self.assertEqual(connect.call_count, 3)
        self.assertFalse(result.exception.uncertain)
        self.assertFalse(result.exception.permanent)

    def test_post_retries_only_confirmed_unsent_connection_failure(self):
        client = Client(REPOSITORY, "mock-token")
        with patch.object(
            client.opener,
            "open",
            side_effect=[URLError(ConnectionSetupError(TimeoutError())), self.response(b'{"number":1}')],
        ) as opened:
            self.assertEqual(client.request("POST", "/issues", {"title": "test"}), {"number": 1})
            self.assertEqual(opened.call_count, 2)

    def test_post_response_timeout_does_not_repeat_remote_write(self):
        client = Client(REPOSITORY, "mock-token")
        response = self.response()
        response.read.side_effect = TimeoutError("response lost after write")
        with (
            patch.object(client.opener, "open", return_value=response) as opened,
            self.assertRaises(RemoteError) as result,
        ):
            client.request("POST", "/issues", {"title": "test"})
        self.assertEqual(opened.call_count, 1)
        self.assertTrue(result.exception.uncertain)

    def test_tls_certificate_verification_is_preserved_without_retry(self):
        client = Client("https://example.test/hugo/cageledger", "mock-token")
        with (
            patch(
                "http.client.HTTPSConnection.connect", side_effect=ssl.SSLCertVerificationError("invalid certificate")
            ) as connect,
            self.assertRaises(RemoteError) as result,
        ):
            client.request("POST", "/issues", {"title": "test"})
        self.assertEqual(connect.call_count, 1)
        self.assertFalse(result.exception.uncertain)

    def test_attachment_download_retries_safe_reads(self):
        client = Client(REPOSITORY, "mock-token")
        with patch.object(
            client.opener, "open", side_effect=[URLError(TimeoutError()), self.response(b"image")]
        ) as opened:
            self.assertEqual(client.download_asset(client.base + "/attachments/id"), b"image")
            self.assertEqual(opened.call_count, 2)

    def test_connection_refusal_is_retryable_but_timeout_is_uncertain(self):
        client = Client(REPOSITORY, "mock-token")
        for reason, uncertain in [(ConnectionRefusedError("refused"), False), (TimeoutError("timed out"), True)]:
            with (
                patch.object(client.opener, "open", side_effect=URLError(reason)),
                self.assertRaises(RemoteError) as error,
            ):
                client.request("POST", "/issues", {"title": "test"})
            self.assertEqual(error.exception.uncertain, uncertain)

    def test_http_404_keeps_status_for_safe_deletion_reconciliation(self):
        client = Client(REPOSITORY, "mock-token")
        with patch.object(client.opener, "open", side_effect=HTTPError(REPOSITORY, 404, "missing", {}, None)):
            with self.assertRaises(RemoteError) as result:
                client.request("GET", "/issues/1")
        self.assertEqual(result.exception.http_status, 404)
        self.assertTrue(result.exception.permanent)
        self.assertFalse(client.auth_blocked)

    def test_shared_readonly_token_keeps_release_read_and_issue_permission_error(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"tag_name":"v1.5.0"}')

            def do_POST(self):
                self.send_response(403)
                self.end_headers()
                self.wfile.write(b'{"message":"sensitive token must not leak"}')

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = Client(f"http://127.0.0.1:{server.server_port}/hugo/cageledger", "mock-readonly-token")
            with patch.multiple(
                system, CAGELEDGER_REPOSITORY_URL=client.repository, CAGELEDGER_GITEA_TOKEN="mock-readonly-token"
            ):
                self.assertEqual(system.latest_remote_release()["version"], "v1.5.0")
            self.assertEqual(client.request("GET", "/releases/latest")["tag_name"], "v1.5.0")
            with self.assertRaises(RemoteError) as result:
                client.request("POST", "/issues", {"title": "test"})
            self.assertTrue(result.exception.permanent)
            self.assertTrue(client.auth_blocked)
            self.assertNotIn("sensitive", str(result.exception))
            self.assertNotIn("mock-readonly-token", str(result.exception))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_untrusted_attachment_urls_are_rejected_before_network(self):
        client = Client(REPOSITORY, "mock-token")
        for url in (
            "http://evil.test/attachments/id",
            "file:///etc/passwd",
            "http://127.0.0.1:7777/attachments/../secret",
            "http://127.0.0.1:7777/attachments/id?token=x",
        ):
            with self.subTest(url=url), self.assertRaises(RemoteError):
                client.download_asset(url)
