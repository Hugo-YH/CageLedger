"""Render retained quarantine forms as PDF with an isolated Writer profile."""

import hashlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from threading import BoundedSemaphore, RLock

from server_app.cache import cache_generation, cache_get, cache_key, cache_set
from server_app.runtime_logging import log_operation

from .documents import generate as generate_docx

TIMEOUT_SECONDS = 120
_RENDER_SLOT = BoundedSemaphore(1)
_FONT_CONFIG = Path(__file__).resolve().parents[2] / "resources" / "quarantine" / "fonts.conf"
_CACHE_LOCKS = tuple(RLock() for _ in range(32))


class PdfRenderError(RuntimeError):
    """A report could not be converted; callers must not issue a partial report."""


def libreoffice_binary():
    configured = os.environ.get("CAGELEDGER_LIBREOFFICE_BIN", "").strip()
    binary = configured or shutil.which("soffice") or shutil.which("libreoffice")
    if not binary or not Path(binary).is_file() or not os.access(binary, os.X_OK):
        raise PdfRenderError("检疫 PDF 转换组件不可用，请配置 CAGELEDGER_LIBREOFFICE_BIN")
    return str(binary)


def generate(snapshot, root, *, draft=False):
    return render_document(
        snapshot, lambda: generate_docx(snapshot, root, draft=draft), root=root, kind=f"test:{draft}"
    )


def _file_identity(path):
    path = Path(path)
    try:
        stat = path.stat()
    except FileNotFoundError:
        return [str(path), "missing"]
    return [str(path.resolve()), stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns]


def _renderer_identity(binary):
    templates = _FONT_CONFIG.parent / "templates"
    return {
        "binary": _file_identity(binary),
        "templates": {
            path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(templates.iterdir())
            if path.is_file()
        },
        "fontConfig": hashlib.sha256(_FONT_CONFIG.read_bytes()).hexdigest(),
        "customFontConfig": _file_identity(os.environ["FONTCONFIG_FILE"])
        if os.environ.get("FONTCONFIG_FILE")
        else None,
        "locale": {name: os.environ.get(name, "") for name in ("LANG", "LC_ALL", "FONTCONFIG_PATH")},
    }


def _cached_render(key, operation):
    # Only conversion enters this lock. It is never acquired while holding a
    # SQLite write transaction, and document rendering does not nest cache locks.
    with _CACHE_LOCKS[hash(key) % len(_CACHE_LOCKS)]:
        value = cache_get(key)
        if value is not None:
            return value
        generation = cache_generation()
        content = operation()
        return cache_set(key, content, ttl_seconds=300, expected_generation=generation)


def render_document(snapshot, build_docx, *, root=None, kind):
    binary = libreoffice_binary()
    references = []
    if root is not None:
        for attachment in snapshot.get("attachments", []):
            if attachment.get("mime", "").startswith("image/") and not attachment.get("removed"):
                for field in ("storageName", "previewStorageName"):
                    if attachment.get(field):
                        references.append(_file_identity(Path(root) / attachment[field]))
    key = cache_key(
        "quarantine_pdf_document",
        snapshot=snapshot,
        kind=kind,
        root=str(Path(root).resolve()) if root else None,
        references=references,
        renderer=_renderer_identity(binary),
    )
    return _cached_render(key, lambda: _convert_docx(build_docx(), binary))


@log_operation("word_pdf_conversion", component="exports")
def convert_docx(content):
    binary = libreoffice_binary()
    key = cache_key(
        "quarantine_pdf_legacy", source=hashlib.sha256(content).hexdigest(), renderer=_renderer_identity(binary)
    )
    return _cached_render(key, lambda: _convert_docx(content, binary))


def _convert_docx(content, binary):
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
