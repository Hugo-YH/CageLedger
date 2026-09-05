import io
import unittest
from email.message import Message

from server_app.web.request_body import RequestBodyError, parse_json_object, read_body


class RequestBodyTests(unittest.TestCase):
    def test_rejects_ambiguous_or_invalid_framing(self):
        for values in (("2", "2"), ("-1",), ("2,2",), ("99999999999",), ("33554433",)):
            headers = Message()
            for value in values:
                headers["Content-Length"] = value
            with self.subTest(values=values), self.assertRaises(RequestBodyError):
                read_body(headers, io.BytesIO(b"{}"))
        headers = Message()
        headers["Transfer-Encoding"] = "chunked"
        with self.assertRaises(RequestBodyError):
            read_body(headers, io.BytesIO(), optional=True)

    def test_rejects_truncated_body(self):
        headers = Message()
        headers["Content-Length"] = "10"
        with self.assertRaisesRegex(RequestBodyError, "不完整"):
            read_body(headers, io.BytesIO(b"{}"))

    def test_optional_empty_and_valid_object(self):
        self.assertEqual(read_body(Message(), io.BytesIO(), optional=True), b"")
        self.assertEqual(parse_json_object(b'{"value": 2}'), {"value": 2})

    def test_rejects_invalid_json_shapes_and_encoding(self):
        for raw in (b"null", b"[]", b"123", b"\xff", b'{"v": NaN}', b'{"v": Infinity}', b"{"):
            with self.subTest(raw=raw), self.assertRaises(RequestBodyError):
                parse_json_object(raw)
