"""Select document candidates across the entire immutable PDF, with bounded rendering."""

import math
import os
import re
import subprocess
import time
from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory, TemporaryFile

from server_app.config import RECEPTION_PDFINFO_BIN, RECEPTION_PDFTOPPM_BIN
from server_app.runtime_logging import log_stage

from . import certificate_files as files

VERSION = "document-frames-v1"
MAX_AI_PAGES = 20
MAX_RENDER_SECONDS = 45
MAX_IMAGES_BYTES = 30 * 1024 * 1024
_SIZE = re.compile(rb"^Page\s+(\d+)\s+size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts", re.MULTILINE)


def select_pages(dimensions, *, include_all=False):
    selected, skipped = [], []
    for number, width, height in dimensions:
        if (
            not all(math.isfinite(value) for value in (width, height))
            or min(width, height) <= 0
            or max(width, height) > 100_000
        ):
            raise ValueError("PDF页面尺寸异常，请检查原件")
        ratio = min(width, height) / max(width, height)
        paper = abs(ratio - 2**-0.5) <= 0.012 or abs(ratio - 0.5) <= 0.012 or abs(ratio - 2**-1.5) <= 0.012
        phone = any(abs(ratio - value) <= 0.008 for value in (3 / 4, 9 / 16, 2 / 3, 4 / 5, 1))
        # The first page and unfamiliar frames stay in scope. A frame is only a
        # candidate filter, never proof of certificate content; users can include all.
        photo = number != 1 and not paper and phone and max(width, height) >= 1000
        (skipped if photo and not include_all else selected).append(number)
    return {
        "totalPages": len(dimensions),
        "selectedPages": selected,
        "skippedPhotoPages": skipped,
        "mode": "all" if include_all else "auto",
    }


def _info(original, page_count, env):
    with TemporaryFile() as output:
        result = subprocess.run(
            [files.tool(RECEPTION_PDFINFO_BIN, "pdfinfo"), "-f", "1", "-l", str(page_count), str(original)],
            stdout=output,
            stderr=subprocess.DEVNULL,
            timeout=15,
            env=env,
            check=False,
        )
        output.seek(0)
        info = output.read(65537)
    count = re.search(rb"^Pages:\s+(\d+)", info, re.MULTILINE)
    if (
        result.returncode
        or len(info) > 65536
        or not count
        or int(count[1]) != page_count
        or re.search(rb"^Encrypted:\s+yes", info, re.MULTILINE)
    ):
        raise ValueError("PDF页数或原件内容异常，请检查文件后重试")
    dimensions = [(int(n), float(w), float(h)) for n, w, h in _SIZE.findall(info)]
    if [number for number, _, _ in dimensions] != list(range(1, page_count + 1)):
        raise ValueError("无法完整读取PDF每页画幅，请检查原件")
    return dimensions


def prepare(content, page_count, first_preview, *, include_all=False):
    try:
        with ExitStack() as resources:
            with log_stage("reception_certificate_recognition", "pdf_parse", component="reception"):
                if type(page_count) is not int or not 1 <= page_count <= 100:
                    raise ValueError("合格证PDF须为1至100页")
                if (
                    not isinstance(content, bytes)
                    or not content.startswith(b"%PDF-")
                    or len(content) > files.MAX_FILE_BYTES
                ):
                    raise ValueError("合格证PDF原件无效")
                env = {**os.environ, "LC_ALL": "C", "LANG": "C"}
                resources.enter_context(files.rendering())
                temporary = resources.enter_context(TemporaryDirectory(prefix="cageledger-certificate-pages-"))
                root = Path(temporary)
                original = root / "source.pdf"
                original.write_bytes(content)
                deadline = time.monotonic() + MAX_RENDER_SECONDS
                dimensions = _info(original, page_count, env)
                selection = select_pages(dimensions, include_all=include_all)
                if len(selection["selectedPages"]) > MAX_AI_PAGES:
                    raise ValueError(f"本次候选识别页超过{MAX_AI_PAGES}页，请拆分PDF后分别上传；原件已保留")
            with log_stage("reception_certificate_recognition", "page_render", component="reception"):
                images, total_bytes = [], 0
                for number in selection["selectedPages"]:
                    if number == 1:
                        image = first_preview
                    else:
                        target = root / f"page-{number}"
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            raise files.CertificateUnavailableError("合格证逐页处理超时，请稍后重试或拆分PDF")
                        result = subprocess.run(
                            [
                                files.tool(RECEPTION_PDFTOPPM_BIN, "pdftoppm"),
                                "-f",
                                str(number),
                                "-l",
                                str(number),
                                "-singlefile",
                                "-scale-to",
                                "3000",
                                "-png",
                                str(original),
                                str(target),
                            ],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            timeout=min(30, remaining),
                            env=env,
                            check=False,
                        )
                        output = target.with_suffix(".png")
                        if (
                            result.returncode
                            or not output.is_file()
                            or not 0 < output.stat().st_size <= 15 * 1024 * 1024
                        ):
                            raise ValueError(f"PDF第{number}页无法生成识别图片，未提交不完整识别；请检查原件")
                        image = output.read_bytes()
                        output.unlink()
                    total_bytes += len(image)
                    if total_bytes > MAX_IMAGES_BYTES:
                        raise ValueError("识别图片合计超过30MiB，请拆分PDF后分别上传；原件已保留")
                    images.append({"pageNumber": number, "image": image})
            return images, {**selection, "version": VERSION, "dimensions": [list(page) for page in dimensions]}
    except subprocess.TimeoutExpired as exc:
        raise files.CertificateUnavailableError("合格证逐页处理超时，请稍后重试或拆分PDF") from exc
