import unittest
from email.message import Message
from unittest.mock import patch

from server_app.web import origin


def headers(host="cageledger.example", request_origin=None):
    value = Message()
    value["Host"] = host
    if request_origin is not None:
        value["Origin"] = request_origin
    return value


class HttpOriginTests(unittest.TestCase):
    def test_allows_non_browser_clients_and_same_origin(self):
        self.assertTrue(origin.is_origin_allowed(headers()))
        self.assertTrue(origin.is_origin_allowed(headers(request_origin="https://cageledger.example")))
        self.assertTrue(origin.is_origin_allowed(headers("127.0.0.1:5173", "http://127.0.0.1:5173")))

    def test_rejects_foreign_and_malformed_origins(self):
        for value in (
            "null",
            "https://evil.example",
            "https://cageledger.example.evil.example",
            "https://user:password@cageledger.example",
            "file:///tmp/test",
            "https://cageledger.example/path",
        ):
            with self.subTest(value=value):
                self.assertFalse(origin.is_origin_allowed(headers(request_origin=value)))

    def test_explicit_allowlist_is_exact(self):
        with patch.object(origin, "CORS_ALLOWED_ORIGINS", frozenset({"https://workspace.example"})):
            supplied = headers(request_origin="https://workspace.example")
            self.assertTrue(origin.is_origin_allowed(supplied))
            self.assertEqual(origin.cors_response_origin(supplied), "https://workspace.example")
            self.assertFalse(origin.is_origin_allowed(headers(request_origin="https://sub.workspace.example")))
