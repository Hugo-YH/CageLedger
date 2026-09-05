import unittest

from server_app.web.multipart import parse_multipart_upload


class MultipartUploadTests(unittest.TestCase):
    def test_preserves_trailing_newlines_and_boundary_text_inside_file(self):
        for body in (b"", b"report\r\n\n\r", b"prefix--boundary-suffix\r\n", b"\x00\xff\r\n"):
            with self.subTest(body=body):
                raw = (
                    b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="report.csv"\r\n\r\n'
                    + body
                    + b"\r\n--boundary--\r\n"
                )
                self.assertEqual(parse_multipart_upload("multipart/form-data; boundary=boundary", raw)[1], body)

    def test_rejects_truncated_upload(self):
        raw = b'--boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\nincomplete'
        with self.assertRaisesRegex(ValueError, "格式不完整"):
            parse_multipart_upload("multipart/form-data; boundary=boundary", raw)

    def test_rejects_invalid_boundary_and_header_injection(self):
        for suffix in ('boundary=""', "boundary=" + "x" * 71, "boundary=b\r\nX-Test: injected"):
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                parse_multipart_upload("multipart/form-data; " + suffix, b"")

    def test_rejects_duplicate_file_fields(self):
        part = b'--boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\ncontent\r\n'
        with self.assertRaisesRegex(ValueError, "只能上传一个"):
            parse_multipart_upload("multipart/form-data; boundary=boundary", part * 2 + b"--boundary--\r\n")

    def test_reads_file_name_and_preserves_binary_content(self):
        boundary = "CageLedgerBoundary"
        file_body = b"\x00report\r\nbytes\xff"
        raw = (
            b"--CageLedgerBoundary\r\n"
            b'Content-Disposition: form-data; name="file"; filename="report.xlsx"\r\n'
            b"Content-Type: application/octet-stream\r\n\r\n" + file_body + b"\r\n--CageLedgerBoundary--\r\n"
        )

        filename, parsed_body = parse_multipart_upload(f"multipart/form-data; boundary={boundary}", raw)

        self.assertEqual(filename, "report.xlsx")
        self.assertEqual(parsed_body, file_body)

    def test_reads_quoted_boundary_and_skips_other_fields(self):
        raw = (
            b"--quoted-boundary\r\n"
            b'Content-Disposition: form-data; name="note"\r\n\r\n'
            b"ignored\r\n"
            b"--quoted-boundary\r\n"
            b'Content-Disposition: form-data; name="file"; filename="catalog.json"\r\n\r\n'
            b"{}\r\n"
            b"--quoted-boundary--\r\n"
        )

        self.assertEqual(
            parse_multipart_upload('multipart/form-data; boundary="quoted-boundary"', raw),
            ("catalog.json", b"{}"),
        )

    def test_rejects_non_multipart_content(self):
        with self.assertRaisesRegex(ValueError, "请使用 multipart/form-data 上传文件"):
            parse_multipart_upload("application/json", b"{}")

    def test_rejects_missing_boundary(self):
        with self.assertRaisesRegex(ValueError, "上传请求缺少 multipart boundary"):
            parse_multipart_upload("multipart/form-data", b"")

    def test_rejects_missing_file_field(self):
        raw = b'--boundary\r\nContent-Disposition: form-data; name="note"\r\n\r\nignored\r\n--boundary--\r\n'
        with self.assertRaisesRegex(ValueError, "没有找到上传字段 file"):
            parse_multipart_upload("multipart/form-data; boundary=boundary", raw)
