"""Validated image bytes and transaction-bound provenance; no base64 enters SQLite."""

import base64
import binascii
import hashlib
import os
import re
import warnings
from dataclasses import dataclass
from io import BytesIO
from urllib.parse import quote
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

from server_app.config import INTAKE_RECOGNITION_IMAGES_PATH
from server_app.domains.intake.repository import get_batch_payload

MAX_IMAGES = 4
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 15 * 1024 * 1024
FORMATS = {"PNG": ("image/png", ".png"), "JPEG": ("image/jpeg", ".jpg"), "WEBP": ("image/webp", ".webp")}
MIME_SUFFIX = {mime: suffix for mime, suffix in FORMATS.values()}


@dataclass(frozen=True)
class RecognitionImage:
    name: str
    mime: str
    body: bytes

    @property
    def data_url(self):
        return f"data:{self.mime};base64,{base64.b64encode(self.body).decode('ascii')}"


def decode_images(raw):
    if not isinstance(raw, list) or len(raw) > MAX_IMAGES:
        raise ValueError("一次最多识别或新增 4 张预约图片")
    images, total = [], 0
    for index, item in enumerate(raw):
        if not isinstance(item, dict) or not isinstance(item.get("dataUrl"), str):
            raise ValueError("预约图片数据格式无效")
        value = item["dataUrl"]
        if len(value) > ((MAX_IMAGE_BYTES + 2) // 3) * 4 + 100:
            raise ValueError("每张预约图片不能超过 5 MiB")
        match = re.fullmatch(r"data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)", value)
        if not match:
            raise ValueError("预约图片仅支持 PNG、JPEG 或 WebP")
        try:
            content = base64.b64decode(match[2], validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValueError("预约图片编码无效") from exc
        if not content or len(content) > MAX_IMAGE_BYTES:
            raise ValueError("每张预约图片须为有效图片且不能超过 5 MiB")
        total += len(content)
        if total > MAX_TOTAL_BYTES:
            raise ValueError("预约图片合计不能超过 15 MiB")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(content), formats=list(FORMATS)) as image:
                    if image.width * image.height > 25_000_000 or max(image.size) > 8192:
                        raise ValueError("预约图片尺寸过大，请使用清晰的页面截图")
                    if image.format not in FORMATS or FORMATS[image.format][0] != match[1]:
                        raise ValueError("预约图片内容与文件格式不一致")
                    if getattr(image, "n_frames", 1) != 1:
                        raise ValueError("预约识别仅支持静态图片")
                    image.verify()
                with Image.open(BytesIO(content), formats=list(FORMATS)) as image:
                    image.load()
        except (
            UnidentifiedImageError,
            OSError,
            SyntaxError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
        ) as exc:
            raise ValueError("预约图片损坏或无法读取") from exc
        name = str(item.get("name") or f"预约图片{index + 1}").replace("\\", "/").rsplit("/", 1)[-1]
        name = "".join(char for char in name if char.isprintable())[:160].strip() or f"预约图片{index + 1}"
        images.append(RecognitionImage(name, match[1], content))
    return images


class ImageWriteSession:
    """Remove only newly owned files if the associated SQLite transaction fails."""

    def __init__(self):
        self.created = []
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        if not self.committed:
            for path in self.created:
                path.unlink(missing_ok=True)

    def save(self, batch_id, images, existing, at):
        result = list(existing)
        identities = {(item.get("sha256"), item.get("name")) for item in result}
        added = []
        for image in images:
            digest = hashlib.sha256(image.body).hexdigest()
            if (digest, image.name) in identities:
                continue
            if len(result) >= 20:
                raise ValueError("该批次的预约来源图片已达 20 张上限")
            identity = uuid4().hex
            root = INTAKE_RECOGNITION_IMAGES_PATH
            root.mkdir(parents=True, exist_ok=True)
            path = root / (identity + MIME_SUFFIX[image.mime])
            # UUID names are exclusively owned by this attempt; originals are never replaced.
            with path.open("xb") as output:
                self.created.append(path)
                output.write(image.body)
                output.flush()
                os.fsync(output.fileno())
            item = {
                "id": identity,
                "name": image.name,
                "mime": image.mime,
                "size": len(image.body),
                "sha256": digest,
                "createdAt": at,
                "url": f"/api/intake-batches/{quote(batch_id, safe='')}/recognition-images/{identity}",
            }
            result.append(item)
            added.append(item)
            identities.add((digest, image.name))
        return result, added


def read_image(conn, batch_id, image_id):
    if "/" in batch_id or not re.fullmatch(r"[a-f0-9]{32}", image_id):
        raise LookupError("预约来源图片不存在")
    batch = get_batch_payload(conn, batch_id)
    if not batch:
        raise LookupError("待接收批次不存在")
    metadata = batch.get("recognition") or {}
    item = next((entry for entry in metadata.get("images", []) if entry.get("id") == image_id), None)
    if not item or item.get("mime") not in MIME_SUFFIX:
        raise LookupError("预约来源图片不存在")
    path = INTAKE_RECOGNITION_IMAGES_PATH / (image_id + MIME_SUFFIX[item["mime"]])
    if not path.is_file():
        raise LookupError("预约来源图片文件暂缺，请联系管理员核对备份")
    name = str(item.get("name") or "预约图片").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(char for char in name if char.isprintable())[:160].strip() or "预约图片"
    return path.read_bytes(), name, item["mime"]
