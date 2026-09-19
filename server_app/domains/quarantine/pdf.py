"""Render retained quarantine forms as PDF with an isolated Writer profile."""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from threading import BoundedSemaphore

from .documents import generate as generate_docx

TIMEOUT_SECONDS = 120
_RENDER_SLOT = BoundedSemaphore(1)
_FONT_CONFIG = Path(__file__).resolve().parents[2] / "resources" / "quarantine" / "fonts.conf"


class PdfRenderError(RuntimeError):
    """A report could not be converted; callers must not issue a partial report."""


def libreoffice_binary():
    configured = os.environ.get("CAGELEDGER_LIBREOFFICE_BIN", "").strip()
    binary = configured or shutil.which("soffice") or shutil.which("libreoffice")
    if not binary or not Path(binary).is_file() or not os.access(binary, os.X_OK):
        raise PdfRenderError("检疫 PDF 转换组件不可用，请配置 CAGELEDGER_LIBREOFFICE_BIN")
    return str(binary)


def generate(snapshot, root, *, draft=False):
    return convert_docx(generate_docx(snapshot, root, draft=draft))


def convert_docx(content):
    binary = libreoffice_binary()
    if not _RENDER_SLOT.acquire(timeout=TIMEOUT_SECONDS):
        raise PdfRenderError("检疫 PDF 生成繁忙，请稍后重试")
    try:
        with tempfile.TemporaryDirectory(prefix="cageledger-quarantine-pdf-") as temporary:
            directory = Path(temporary)
            source = directory / "report.docx"
            source.write_bytes(content)
            environment = os.environ.copy()
            environment.setdefault("FONTCONFIG_FILE", str(_FONT_CONFIG))
            environment["SAL_USE_VCLPLUGIN"] = "svp"
            try:
                result = subprocess.run(
                    [
                        binary,
                        "-env:UserInstallation=" + (directory / "profile").as_uri(),
                        "--headless",
                        "--norestore",
                        "--convert-to",
                        "pdf:writer_pdf_Export",
                        "--outdir",
                        str(directory),
                        str(source),
                    ],
                    cwd=directory,
                    env=environment,
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    timeout=TIMEOUT_SECONDS,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise PdfRenderError("检疫 PDF 生成超时，请稍后重试") from exc
            except OSError as exc:
                raise PdfRenderError("检疫 PDF 转换组件启动失败") from exc
            output = directory / "report.pdf"
            if result.returncode != 0 or not output.is_file():
                raise PdfRenderError("检疫 PDF 生成失败，未完成出具，请稍后重试")
            data = output.read_bytes()
            if not data.startswith(b"%PDF-") or b"%%EOF" not in data[-1024:]:
                raise PdfRenderError("检疫 PDF 文件不完整，请稍后重试")
            return data
    finally:
        _RENDER_SLOT.release()
