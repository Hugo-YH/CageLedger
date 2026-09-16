import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from server_app.domains.quarantine import pdf


class QuarantinePdfTests(unittest.TestCase):
    def test_conversion_uses_isolated_profile_and_removes_temporary_files(self):
        directories = []

        def render(command, **kwargs):
            directory = Path(kwargs["cwd"])
            directories.append(directory)
            self.assertEqual((directory / "report.docx").read_bytes(), b"source")
            self.assertIn("-env:UserInstallation=" + (directory / "profile").as_uri(), command)
            self.assertEqual(kwargs["timeout"], pdf.TIMEOUT_SECONDS)
            (directory / "report.pdf").write_bytes(b"%PDF-1.7\nverified\n%%EOF")
            return subprocess.CompletedProcess(command, 0)

        with (
            patch.object(pdf, "libreoffice_binary", return_value="writer"),
            patch.object(pdf.subprocess, "run", side_effect=render),
        ):
            self.assertTrue(pdf.convert_docx(b"source").startswith(b"%PDF-"))
            pdf.convert_docx(b"source")
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
