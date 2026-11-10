import unittest

from server_app.web.multipart import parse_multipart_files, parse_multipart_upload


class MultipartUploadTests(unittest.TestCase):
    @staticmethod
    def upload_part(body, *, headers=b'Content-Disposition: form-data; name="file"; filename="report.bin"'):
        return b"--boundary\r\n" + headers + b"\r\n\r\n" + body + b"\r\n--boundary--\r\n"

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

    def test_rejects_missing_or_malformed_closing_delimiter(self):
        raw = self.upload_part(b"binary\x00\xff")
        for closing in (b"--boundary", b"--boundary-", b"--boundary--suffix", b"--boundary-- \tX"):
            with self.subTest(closing=closing), self.assertRaisesRegex(ValueError, "格式不完整"):
                parse_multipart_upload(
                    "multipart/form-data; boundary=boundary", raw.replace(b"--boundary--\r\n", closing)
                )

    def test_preserves_boundary_prefixes_that_are_not_delimiter_lines(self):
        body = (
            b"--boundary-suffix\r\n"
            b"prefix--boundary\r\n"
            b"\r\n--boundary--suffix\n"
            b"\n--boundary \tX\r"
            b"\x00--boundary\r\n"
            b"\r\n--boundary\x00\r\n"
            b"\r\n--boundary\t--suffix\r\n"
            b"--boundar\r\n"
            b"\x00\xff"
        )
        self.assertEqual(
            parse_multipart_upload("multipart/form-data; boundary=boundary", self.upload_part(body)),
            ("report.bin", body),
        )

    def test_preserves_thirty_mebibyte_binary_file(self):
        body = bytes(range(256)) * (30 * 1024 * 1024 // 256)
        self.assertEqual(
            parse_multipart_upload("multipart/form-data; boundary=boundary", self.upload_part(body)),
            ("report.bin", body),
        )

    def test_accepts_supported_line_endings_and_boundary_padding(self):
        for newline in (b"\r\n", b"\n", b"\r"):
            raw = newline.join(
                (
                    b"preamble",
                    b"--boundary \t",
                    b'Content-Disposition: form-data; name="file"',
                    b"",
                    b"content\x00\xff",
                    b"--boundary--\t ",
                    b"epilogue",
                )
            )
            with self.subTest(newline=newline):
                self.assertEqual(
                    parse_multipart_upload("multipart/form-data; boundary=boundary", raw), ("", b"content\x00\xff")
                )

    def test_accepts_closing_delimiter_at_end_of_input(self):
        self.assertEqual(
            parse_multipart_upload("multipart/form-data; boundary=boundary", self.upload_part(b"content")[:-2]),
            ("report.bin", b"content"),
        )

    def test_accepts_empty_file_with_boundary_immediately_after_header_separator(self):
        raw = b'--boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\n--boundary--\r\n'
        self.assertEqual(parse_multipart_upload("multipart/form-data; boundary=boundary", raw), ("", b""))

    def test_rejects_invalid_boundary_and_header_injection(self):
        for suffix in (
            'boundary=""',
            "boundary=" + "x" * 71,
            "boundary=b\r\nX-Test: injected",
            "boundary=b; boundary=other",
            'boundary="trailing "',
        ):
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                parse_multipart_upload("multipart/form-data; " + suffix, b"")

    def test_rejects_duplicate_file_fields(self):
        part = b'--boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\ncontent\r\n'
        with self.assertRaisesRegex(ValueError, "只能上传一个"):
            parse_multipart_upload("multipart/form-data; boundary=boundary", part * 2 + b"--boundary--\r\n")

    def test_multiple_files_keep_input_order_and_ignore_other_fields(self):
        raw = (
            b'--boundary\r\nContent-Disposition: form-data; name="note"\r\n\r\nignored\r\n'
            b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="one.bin"\r\n\r\nfirst\x00\r\n'
            b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="two.bin"\r\n\r\nsecond\xff\r\n'
            b"--boundary--\r\n"
        )
        self.assertEqual(
            parse_multipart_files("multipart/form-data; boundary=boundary", raw, max_files=2),
            [("one.bin", b"first\x00"), ("two.bin", b"second\xff")],
        )
        with self.assertRaisesRegex(ValueError, "最多上传 0"):
            parse_multipart_files("multipart/form-data; boundary=boundary", raw, max_files=0)

    def test_checks_complete_framing_before_file_limit(self):
        part = b'--boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\ncontent\r\n'
        with self.assertRaisesRegex(ValueError, "格式不完整"):
            parse_multipart_upload("multipart/form-data; boundary=boundary", part * 2)

    def test_rejects_duplicate_or_malformed_part_headers(self):
        disposition = b'Content-Disposition: form-data; name="file"'
        for headers in (
            disposition + b"\r\n" + disposition,
            disposition + b"\r\nContent-Type: application/pdf\r\nContent-Type: image/png",
            disposition + b"\r\nX-Test : invalid",
            disposition + b"\r\nX-Test: invalid\x00header",
            disposition + b'; filename="unterminated',
            disposition + b'; name="other"',
            disposition + b'; filename="one.bin"; filename="two.bin"',
            b' name="file"',
        ):
            with self.subTest(headers=headers), self.assertRaisesRegex(ValueError, "格式不完整"):
                parse_multipart_upload(
                    "multipart/form-data; boundary=boundary", self.upload_part(b"content", headers=headers)
                )

    def test_rejects_oversized_or_unterminated_part_headers(self):
        headers = b'Content-Disposition: form-data; name="file"\r\nX-Test: ' + b"x" * (64 * 1024)
        for raw in (self.upload_part(b"content", headers=headers), b"--boundary\r\n" + headers + b"\r\n--boundary--"):
            with self.subTest(size=len(raw)), self.assertRaisesRegex(ValueError, "格式不完整"):
                parse_multipart_upload("multipart/form-data; boundary=boundary", raw)

    def test_rejects_missing_header_body_separator_instead_of_returning_empty_file(self):
        for body in (b"binary\x00\xff", b"X-Data: content-that-is-not-a-header", b""):
            raw = b'--boundary\r\nContent-Disposition: form-data; name="file"\r\n' + body + b"\r\n--boundary--\r\n"
            if not body:
                raw = raw.replace(b"\r\n\r\n--boundary", b"\r\n--boundary")
            with self.subTest(body=body), self.assertRaisesRegex(ValueError, "格式不完整"):
                parse_multipart_upload("multipart/form-data; boundary=boundary", raw)

    def test_rejects_transfer_encoding_and_nested_files(self):
        disposition = b'Content-Disposition: form-data; name="file"'
        for extra_header in (
            b"Content-Transfer-Encoding: base64",
            b"Content-Transfer-Encoding: binary",
            b"Content-Transfer-Encoding:",
            b"Content-Type: multipart/mixed; boundary=nested",
            b"Content-Type: message/rfc822",
        ):
            with self.subTest(extra_header=extra_header), self.assertRaises(ValueError):
                parse_multipart_upload(
                    "multipart/form-data; boundary=boundary",
                    self.upload_part(
                        b"--nested\r\n\r\ncontent\r\n--nested--\r\n", headers=disposition + b"\r\n" + extra_header
                    ),
                )

    def test_reads_utf8_and_rfc_encoded_filenames(self):
        for filename_parameter in (
            'filename="中文合格证.pdf"'.encode(),
            b"filename*=UTF-8''%E4%B8%AD%E6%96%87%E5%90%88%E6%A0%BC%E8%AF%81.pdf",
            b'filename="=?utf-8?b?5Lit5paH5ZCI5qC86K+BLnBkZg==?="',
        ):
            with self.subTest(filename_parameter=filename_parameter):
                self.assertEqual(
                    parse_multipart_upload(
                        "multipart/form-data; boundary=boundary",
                        self.upload_part(
                            b"pdf", headers=b'Content-Disposition: form-data; name="file"; ' + filename_parameter
                        ),
                    ),
                    ("中文合格证.pdf", b"pdf"),
                )

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
