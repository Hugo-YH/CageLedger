import copy
import subprocess
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.quarantine import pdf


class QuarantinePdfTests(unittest.TestCase):
    def setUp(self):
        invalidate_data_cache_prefixes("quarantine_pdf_document::", "quarantine_pdf_legacy::")
        self.addCleanup(invalidate_data_cache_prefixes, "quarantine_pdf_document::", "quarantine_pdf_legacy::")

    def test_conversion_uses_isolated_profile_and_removes_temporary_files(self):
        directories = []

        def render(command, **kwargs):
            directory = Path(kwargs["cwd"])
            directories.append(directory)
            self.assertEqual((directory / "report.docx").read_bytes(), f"source-{len(directories)}".encode())
            self.assertIn("-env:UserInstallation=" + (directory / "profile").as_uri(), command)
            self.assertEqual(kwargs["timeout"], pdf.TIMEOUT_SECONDS)
            (directory / "report.pdf").write_bytes(b"%PDF-1.7\nverified\n%%EOF")
            return subprocess.CompletedProcess(command, 0)

        with (
            patch.object(pdf, "libreoffice_binary", return_value="writer"),
            patch.object(pdf.subprocess, "run", side_effect=render),
        ):
            self.assertTrue(pdf.convert_docx(b"source-1").startswith(b"%PDF-"))
            pdf.convert_docx(b"source-2")
        self.assertNotEqual(*directories)
        self.assertTrue(all(not directory.exists() for directory in directories))

    def test_timeout_and_invalid_output_release_renderer_slot(self):
        with (
            patch.object(pdf, "libreoffice_binary", return_value="writer"),
            patch.object(pdf.subprocess, "run", side_effect=subprocess.TimeoutExpired("writer", 120)),
        ):
            with self.assertRaisesRegex(pdf.PdfRenderError, "超时"):
                pdf.convert_docx(b"source")
        self.assertTrue(pdf._RENDER_SLOT.acquire(blocking=False))
        pdf._RENDER_SLOT.release()

        def invalid(command, **kwargs):
            (Path(kwargs["cwd"]) / "report.pdf").write_bytes(b"not a PDF")
            return subprocess.CompletedProcess(command, 0)

        with (
            patch.object(pdf, "libreoffice_binary", return_value="writer"),
            patch.object(pdf.subprocess, "run", side_effect=invalid),
        ):
            with self.assertRaisesRegex(pdf.PdfRenderError, "不完整"):
                pdf.convert_docx(b"source")

    def test_missing_renderer_has_actionable_error(self):
        with patch.dict("os.environ", {"CAGELEDGER_LIBREOFFICE_BIN": "/missing/cageledger-writer"}):
            with self.assertRaisesRegex(pdf.PdfRenderError, "CAGELEDGER_LIBREOFFICE_BIN"):
                pdf.convert_docx(b"source")

    def test_same_docx_is_converted_once_and_concurrent_requests_share_the_result(self):
        start = threading.Barrier(3)
        entered, release = threading.Event(), threading.Event()
        expected = b"%PDF-1.7\nshared synthetic conversion\n%%EOF"

        def convert(_content, _binary):
            entered.set()
            self.assertTrue(release.wait(5), "Synthetic conversion gate was not released")
            return expected

        def request():
            start.wait(timeout=5)
            return pdf.convert_docx(b"same-original-docx")

        with (
            patch.object(pdf, "libreoffice_binary", return_value="synthetic-writer"),
            patch.object(pdf, "_convert_docx", side_effect=convert) as converter,
            ThreadPoolExecutor(max_workers=2) as workers,
        ):
            first, second = workers.submit(request), workers.submit(request)
            try:
                start.wait(timeout=5)
                self.assertTrue(entered.wait(5))
            finally:
                release.set()
            self.assertEqual(first.result(timeout=5), expected)
            self.assertEqual(second.result(timeout=5), expected)
            self.assertEqual(pdf.convert_docx(b"same-original-docx"), expected)
            self.assertEqual(converter.call_count, 1)

    def test_failed_conversion_is_not_cached_and_successful_retry_is_reused(self):
        expected = b"%PDF-1.7\nretry\n%%EOF"
        with (
            patch.object(pdf, "libreoffice_binary", return_value="synthetic-writer"),
            patch.object(
                pdf, "_convert_docx", side_effect=[pdf.PdfRenderError("Synthetic failure"), expected]
            ) as converter,
        ):
            with self.assertRaises(pdf.PdfRenderError):
                pdf.convert_docx(b"retry-original")
            self.assertEqual(pdf.convert_docx(b"retry-original"), expected)
            self.assertEqual(pdf.convert_docx(b"retry-original"), expected)
            self.assertEqual(converter.call_count, 2)

    def test_document_cache_reuses_only_equal_snapshot_title_files_and_converter_identity(self):
        with tempfile.TemporaryDirectory(prefix="quarantine-pdf-cache-") as temporary:
            root = Path(temporary)
            original, preview, binary = root / "original.png", root / "preview.png", root / "writer"
            original.write_bytes(b"synthetic-original")
            preview.write_bytes(b"synthetic-preview")
            binary.write_bytes(b"synthetic-writer-version-one")
            snapshot = {
                "test": {"notes": "original"},
                "attachments": [
                    {
                        "mime": "image/png",
                        "storageName": original.name,
                        "previewStorageName": preview.name,
                    }
                ],
            }
            builder = Mock(return_value=b"synthetic-docx")
            with (
                patch.object(pdf, "libreoffice_binary", return_value=str(binary)),
                patch.object(pdf, "_convert_docx", return_value=b"%PDF-1.7\nidentity\n%%EOF") as converter,
            ):
                first = pdf.render_document(snapshot, builder, root=root, kind="summary:quarantine")
                self.assertEqual(
                    pdf.render_document(copy.deepcopy(snapshot), builder, root=root, kind="summary:quarantine"), first
                )
                self.assertEqual((builder.call_count, converter.call_count), (1, 1))
                changed = copy.deepcopy(snapshot)
                changed["test"]["notes"] = "changed snapshot"
                pdf.render_document(changed, builder, root=root, kind="summary:quarantine")
                pdf.render_document(snapshot, builder, root=root, kind="summary:self")
                self.assertEqual(converter.call_count, 3)
                original.write_bytes(b"changed-original-with-different-size")
                pdf.render_document(snapshot, builder, root=root, kind="summary:quarantine")
                preview.write_bytes(b"changed-preview-with-different-size")
                pdf.render_document(snapshot, builder, root=root, kind="summary:quarantine")
                self.assertEqual(converter.call_count, 5)
                binary.write_bytes(b"synthetic-writer-version-two-with-different-size")
                pdf.render_document(snapshot, builder, root=root, kind="summary:quarantine")
                with patch.dict("os.environ", {"LANG": "synthetic-render-locale"}):
                    pdf.render_document(snapshot, builder, root=root, kind="summary:quarantine")
                self.assertEqual((builder.call_count, converter.call_count), (7, 7))
