"""Bounded, account-owned original uploads; receipts live only for this server process."""

import hashlib
import re
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from .recognition_images import MAX_IMAGES, MAX_TOTAL_BYTES, RecognitionImage, decode_images, validate_image


class UploadExpired(ValueError):
    def __init__(self):
        super().__init__("预约图片暂存已过期，请重新上传")


class RecognitionBusy(ValueError):
    pass


@dataclass(frozen=True)
class Upload:
    owner: str
    name: str
    mime: str
    size: int
    sha256: str
    deadline: float
    expires_at: str
    path: Path


class RecognitionUploads:
    def __init__(self, *, ttl=1800, max_bytes=128 * 1024**2, max_files=64, clock=time.monotonic):
        self.ttl, self.max_bytes, self.max_files, self.clock = ttl, max_bytes, max_files, clock
        self.records = {}
        self.saved = set()
        self.lock = threading.RLock()
        self.directory = None

    def _prune(self, *, reclaim_saved=False):
        for identity, record in list(self.records.items()):
            if record.deadline <= self.clock() or (reclaim_saved and identity in self.saved):
                record.path.unlink(missing_ok=True)
                del self.records[identity]
                self.saved.discard(identity)

    def close(self):
        with self.lock:
            self.records.clear()
            self.saved.clear()
            if self.directory is not None:
                self.directory.cleanup()
                self.directory = None

    def add(self, owner, files):
        if not owner or not 1 <= len(files) <= MAX_IMAGES:
            raise ValueError("一次须上传 1 至 4 张预约图片")
        if sum(len(body) for _, body in files) > MAX_TOTAL_BYTES:
            raise ValueError("预约图片合计不能超过 15 MiB")
        images = [validate_image(name, body) for name, body in files]
        with self.lock:
            self._prune(reclaim_saved=True)
            size = sum(len(image.body) for image in images)
            owned = [record for record in self.records.values() if record.owner == owner]
            if (
                len(self.records) + len(images) > self.max_files
                or sum(record.size for record in self.records.values()) + size > self.max_bytes
                or len(owned) + len(images) > 16
                or sum(record.size for record in owned) + size > 60 * 1024**2
            ):
                raise RecognitionBusy("预约图片暂存空间繁忙，请稍后重试")
            if self.directory is None:
                self.directory = tempfile.TemporaryDirectory(prefix="cageledger-intake-uploads-")
            staged, result = {}, []
            try:
                for image in images:
                    identity = uuid4().hex
                    path = Path(self.directory.name) / identity
                    record = Upload(
                        owner,
                        image.name,
                        image.mime,
                        len(image.body),
                        hashlib.sha256(image.body).hexdigest(),
                        self.clock() + self.ttl,
                        datetime.fromtimestamp(time.time() + self.ttl, UTC).isoformat(),
                        path,
                    )
                    with path.open("xb") as output:
                        staged[identity] = record
                        output.write(image.body)
                    result.append(
                        {
                            "uploadId": identity,
                            "name": record.name,
                            "mime": record.mime,
                            "size": record.size,
                            "sha256": record.sha256,
                            "expiresAt": record.expires_at,
                        }
                    )
            except BaseException:
                for record in staged.values():
                    record.path.unlink(missing_ok=True)
                raise
            self.records.update(staged)
            return result

    def mark_saved(self, owner, refs):
        """A committed batch owns independent durable originals; reclaim only its temporary copies."""
        with self.lock:
            for ref in refs:
                identity = ref["uploadId"]
                record = self.records.get(identity)
                if record is not None and record.owner == owner:
                    self.saved.add(identity)

    def resolve(self, owner, refs):
        if not isinstance(refs, list) or len(refs) > MAX_IMAGES:
            raise ValueError("一次最多识别或新增 4 张预约图片")
        result = []
        with self.lock:
            self._prune()
            for ref in refs:
                if (
                    not isinstance(ref, dict)
                    or set(ref) != {"uploadId"}
                    or not isinstance(ref["uploadId"], str)
                    or not re.fullmatch(r"[a-f0-9]{32}", ref["uploadId"])
                ):
                    raise ValueError("预约图片引用格式无效")
                record = self.records.get(ref["uploadId"])
                if record is None:
                    raise UploadExpired()
                if not owner or record.owner != owner:
                    raise ValueError("预约图片引用不属于当前账号")
                try:
                    with record.path.open("rb") as source:
                        body = source.read(record.size + 1)
                except FileNotFoundError:
                    self.records.pop(ref["uploadId"], None)
                    self.saved.discard(ref["uploadId"])
                    raise UploadExpired() from None
                if len(body) != record.size or hashlib.sha256(body).hexdigest() != record.sha256:
                    raise ValueError("预约原图校验失败，请重新上传")
                result.append(RecognitionImage(record.name, record.mime, body))
            if sum(len(image.body) for image in result) > MAX_TOTAL_BYTES:
                raise ValueError("预约图片合计不能超过 15 MiB")
        return result


UPLOADS = RecognitionUploads()


def request_images(payload, owner, *, raw_key="images", refs_key="imageRefs"):
    if raw_key in payload and payload[raw_key] != [] and refs_key in payload:
        raise ValueError("预约图片原文与引用不能同时提交")
    if refs_key in payload:
        return UPLOADS.resolve(owner, payload[refs_key])
    return decode_images(payload.get(raw_key, []))


def acknowledge_saved_images(payload, owner):
    if payload.get("recognitionImageRefs"):
        UPLOADS.mark_saved(owner, payload["recognitionImageRefs"])
