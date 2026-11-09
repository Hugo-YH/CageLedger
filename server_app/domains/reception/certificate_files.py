"""Bounded PDF validation/rendering and immutable, opaque attachment paths."""

import hashlib
import os
import re
import shutil
import stat
import subprocess
import time
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory, TemporaryFile
from threading import BoundedSemaphore

from PIL import Image

from server_app.config import (
    RECEPTION_CERTIFICATE_FILES_PATH,
    RECEPTION_CERTIFICATE_PAGE_TIMEOUT_SECONDS,
    RECEPTION_PDFINFO_BIN,
    RECEPTION_PDFTOPPM_BIN,
)
from server_app.heavy_work import DOCUMENT_WORK, HeavyWorkBusy
from server_app.runtime_logging import log_context, log_stage

MAX_FILE_BYTES = 30 * 1024 * 1024
MAX_ATTACHMENTS = 20
MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_IMAGE_EDGE = 3000
_RENDER_SLOTS = BoundedSemaphore(2)


class CertificateUnavailableError(Exception):
    pass


def filename(value):
    name = str(value or "").replace("\\", "/").rsplit("/", 1)[-1]
    return "".join(char for char in name if char.isprintable())[:160].strip() or "合格证.pdf"


def tool(configured, name):
    candidate = configured or shutil.which(name)
    if not candidate or not Path(candidate).is_file():
        raise CertificateUnavailableError("合格证PDF处理组件未安装，请联系管理员")
    return str(candidate)


def render_page(original, target, number, *, env, timeout=RECEPTION_CERTIFICATE_PAGE_TIMEOUT_SECONDS):
    """Rasterize only one selected page; preserve RGB pixels without Poppler's slow PNG encoding."""
    deadline = time.monotonic() + timeout
    output = target.with_suffix(".ppm")
    try:
        with log_context(pageNumber=number, timeoutSeconds=round(timeout, 3)):
            with log_stage("reception_certificate_render", "rasterize", component="reception"):
                result = subprocess.run(
                    [
                        tool(RECEPTION_PDFTOPPM_BIN, "pdftoppm"),
                        "-f",
                        str(number),
                        "-l",
                        str(number),
                        "-singlefile",
                        "-scale-to",
                        str(MAX_IMAGE_EDGE),
                        str(original),
                        str(target),
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=timeout,
                    env=env,
                    check=False,
                )
                # P6 RGB raster plus a bounded header. Validate before Pillow allocates pixel memory.
                if (
                    result.returncode
                    or not output.is_file()
                    or not 0 < output.stat().st_size <= MAX_IMAGE_EDGE**2 * 3 + 1024
                ):
                    raise ValueError(f"PDF第{number}页无法生成识别图片，未提交不完整识别；请检查原件")
            with log_stage("reception_certificate_render", "png_encode", component="reception"):
                with Image.open(output) as image:
                    if (
                        image.format != "PPM"
                        or image.mode != "RGB"
                        or not 0 < min(image.size) <= max(image.size) <= MAX_IMAGE_EDGE
                    ):
                        raise ValueError(f"PDF第{number}页识别图片尺寸异常，请检查原件")
                    with BytesIO() as encoded:
                        image.save(encoded, format="PNG", compress_level=3)
                        content = encoded.getvalue()
                    if len(content) > MAX_IMAGE_BYTES:
                        # Preserve the existing byte limit without rejecting a page solely
                        # because the faster, lossless compression produced a larger file.
                        with BytesIO() as encoded:
                            image.save(encoded, format="PNG", compress_level=6)
                            content = encoded.getvalue()
                if time.monotonic() > deadline:
                    raise subprocess.TimeoutExpired("certificate_page", timeout)
                if not 0 < len(content) <= MAX_IMAGE_BYTES:
                    raise ValueError(f"PDF第{number}页识别图片超过15MiB，请拆分或优化扫描件后重试")
                return content
    except subprocess.TimeoutExpired as exc:
        raise CertificateUnavailableError(f"PDF第{number}页转图超时，未提交不完整识别；请稍后重试或拆分PDF") from exc
    finally:
        output.unlink(missing_ok=True)


def prepare(name, content):
    if not isinstance(content, bytes) or not 0 < len(content) <= MAX_FILE_BYTES:
        raise ValueError("合格证PDF须为有效文件且不超过30MiB")
    name = filename(name)
    if not name.lower().endswith(".pdf") or not content.startswith(b"%PDF-"):
        raise ValueError("请上传有效的PDF合格证原件")
    try:
        with DOCUMENT_WORK.slot():
            return _prepare_with_slot(name, content)
    except HeavyWorkBusy as exc:
        raise CertificateUnavailableError(str(exc)) from exc


def _prepare_with_slot(name, content):
    if not _RENDER_SLOTS.acquire(blocking=False):
        raise CertificateUnavailableError("合格证PDF处理繁忙，请稍后重试")
    try:
        with TemporaryDirectory(prefix="cageledger-certificate-") as temporary:
            root = Path(temporary)
            original = root / "source.pdf"
            with log_stage("reception_certificate_upload", "pdf_parse", component="reception"):
                original.write_bytes(content)
                env = {**os.environ, "LC_ALL": "C", "LANG": "C"}
                with TemporaryFile() as output:
                    completed = subprocess.run(
                        [tool(RECEPTION_PDFINFO_BIN, "pdfinfo"), str(original)],
                        stdout=output,
                        stderr=subprocess.DEVNULL,
                        timeout=15,
                        env=env,
                        check=False,
                    )
                    output.seek(0)
                    info = output.read(65537)
                pages = re.search(rb"^Pages:\s+(\d+)", info, re.MULTILINE)
                if (
                    completed.returncode
                    or len(info) > 65536
                    or not pages
                    or re.search(rb"^Encrypted:\s+yes", info, re.MULTILINE)
                ):
                    raise ValueError("PDF损坏、加密或无法读取，请检查原件")
                page_count = int(pages[1])
                if not 1 <= page_count <= 100:
                    raise ValueError("合格证PDF须为1至100页")
            with log_stage("reception_certificate_upload", "preview_render", component="reception"):
                preview = render_page(original, root / "first-page", 1, env=env)
            return {
                "name": name,
                "sha256": hashlib.sha256(content).hexdigest(),
                "size": len(content),
                "page_count": page_count,
            }, preview
    except subprocess.TimeoutExpired as exc:
        raise CertificateUnavailableError("合格证PDF处理超时，请稍后重试或使用较小的扫描件") from exc
    finally:
        _RENDER_SLOTS.release()


@contextmanager
def rendering():
    try:
        with DOCUMENT_WORK.slot():
            with _rendering_with_slot():
                yield
    except HeavyWorkBusy as exc:
        raise CertificateUnavailableError(str(exc)) from exc


@contextmanager
def _rendering_with_slot():
    if not _RENDER_SLOTS.acquire(blocking=False):
        raise CertificateUnavailableError("合格证PDF处理繁忙，请稍后重试")
    try:
        yield
    finally:
        _RENDER_SLOTS.release()


def path(identity, *, preview=False):
    if not re.fullmatch(r"[a-f0-9]{32}", identity):
        raise LookupError("合格证附件不存在")
    return RECEPTION_CERTIFICATE_FILES_PATH / (identity + (".png" if preview else ".pdf"))


@contextmanager
def store(identity, original, preview):
    RECEPTION_CERTIFICATE_FILES_PATH.mkdir(parents=True, exist_ok=True, mode=0o700)
    owned = []
    committed = False

    def commit():
        nonlocal committed
        committed = True

    try:
        with log_stage("reception_certificate_upload", "store_files", component="reception"):
            for target, content in ((path(identity), original), (path(identity, preview=True), preview)):
                with target.open("xb") as output:
                    owned.append(target)
                    os.fchmod(output.fileno(), 0o600)
                    output.write(content)
                    output.flush()
                    os.fsync(output.fileno())
        yield commit
    finally:
        if not committed:
            for target in owned:
                target.unlink(missing_ok=True)


def read(identity, *, preview=False):
    target = path(identity, preview=preview)
    if (
        target.is_symlink()
        or not target.is_file()
        or target.resolve().parent != RECEPTION_CERTIFICATE_FILES_PATH.resolve()
    ):
        raise LookupError("合格证文件暂缺，请联系管理员核对备份")
    maximum = 15 * 1024 * 1024 if preview else MAX_FILE_BYTES
    descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= maximum:
            raise ValueError("合格证文件大小异常，请联系管理员")
        content = stream.read(maximum + 1)
    if len(content) != info.st_size:
        raise ValueError("合格证文件读取期间发生变化，请稍后重试")
    return content
