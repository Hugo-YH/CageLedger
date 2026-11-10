"""Disposable, content-addressed derivatives; never a source of certificate evidence."""

import hashlib
import json
import os
import stat
import struct
import time
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Lock

from server_app.config import DATA_ROOT
from server_app.runtime_logging import log_context, log_stage

MAX_BODY_BYTES = 15 * 1024 * 1024
MAX_HEADER_BYTES = 16 * 1024
_MAGIC = b"CLCC1\n"


class CertificateCache:
    """Bound disk use and concurrent fills without retaining decoded images in RAM."""

    def __init__(self, root, *, max_bytes=256 * 1024 * 1024, max_entries=512, ttl_seconds=24 * 60 * 60):
        self.root = Path(root)
        self.max_bytes = max_bytes
        self.max_entries = max_entries
        self.ttl_seconds = ttl_seconds
        self._disk_lock = Lock()
        # Fixed stripes bound lock bookkeeping even for a stream of unique uploads.
        self._fills = [Lock() for _ in range(32)]

    def remember(self, kind, identity, create):
        key = hashlib.sha256(json.dumps([kind, identity], separators=(",", ":")).encode()).hexdigest()
        with self._fills[int(key[:2], 16) % len(self._fills)]:
            with self._disk_lock:
                cached = self._read(key)
            with log_context(cached=cached is not None):
                with log_stage("reception_certificate_cache", kind, component="reception"):
                    if cached is not None:
                        return cached
                    body, facts = create()
                    # Optional cache failures must not turn a successful conversion into a failed registration.
                    try:
                        with self._disk_lock:
                            self._write(key, body, facts)
                    except (OSError, ValueError, TypeError):
                        pass
                    return body, facts

    def _read(self, key):
        try:
            if self.root.is_symlink():
                return None
            path = self.root / (key + ".cache")
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as source:
                info = os.fstat(source.fileno())
                maximum = len(_MAGIC) + 4 + MAX_HEADER_BYTES + MAX_BODY_BYTES + 32
                if (
                    not stat.S_ISREG(info.st_mode)
                    or not 0 < info.st_size <= min(maximum, self.max_bytes)
                    or time.time() - info.st_mtime > self.ttl_seconds
                ):
                    return None
                prefix = source.read(len(_MAGIC) + 4)
                if not prefix.startswith(_MAGIC) or len(prefix) != len(_MAGIC) + 4:
                    return None
                length = struct.unpack("!I", prefix[-4:])[0]
                if not 0 < length <= MAX_HEADER_BYTES:
                    return None
                header = source.read(length)
                payload = source.read(MAX_BODY_BYTES + 33)
            if len(payload) < 32 or len(payload) > MAX_BODY_BYTES + 32:
                return None
            body, checksum = payload[:-32], payload[-32:]
            digest = hashlib.sha256(prefix)
            digest.update(header)
            digest.update(body)
            if digest.digest() != checksum or info.st_size != len(prefix) + length + len(payload):
                return None
            metadata = json.loads(header)
            if metadata["key"] != key or not isinstance(metadata["facts"], dict):
                return None
            return body, metadata["facts"]
        except (OSError, ValueError, KeyError, TypeError, RecursionError):
            return None

    def _write(self, key, body, facts):
        if not isinstance(body, bytes) or len(body) > MAX_BODY_BYTES or not isinstance(facts, dict):
            return
        header = json.dumps({"key": key, "facts": facts}, separators=(",", ":"), allow_nan=False).encode()
        size = len(_MAGIC) + 4 + len(header) + len(body) + 32
        if len(header) > MAX_HEADER_BYTES or size > self.max_bytes or self.max_entries < 1:
            return
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.root.is_symlink():
            return
        self._prune(size)
        prefix = _MAGIC + struct.pack("!I", len(header))
        digest = hashlib.sha256(prefix)
        digest.update(header)
        digest.update(body)
        temporary = None
        try:
            with NamedTemporaryFile(dir=self.root, prefix=".certificate-", suffix=".tmp", delete=False) as output:
                temporary = Path(output.name)
                output.write(prefix)
                output.write(header)
                output.write(body)
                output.write(digest.digest())
            os.replace(temporary, self.root / (key + ".cache"))
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def _prune(self, incoming):
        entries = []
        for path in self.root.iterdir():
            info = path.lstat()
            if path.suffix == ".cache" and stat.S_ISREG(info.st_mode):
                entries.append((info.st_mtime, path, info.st_size))
            elif path.name.startswith(".certificate-") and time.time() - info.st_mtime > self.ttl_seconds:
                path.unlink(missing_ok=True)
        total, count = sum(item[2] for item in entries), len(entries)
        for modified, path, size in sorted(entries):
            if (
                time.time() - modified > self.ttl_seconds
                or total + incoming > self.max_bytes
                or count >= self.max_entries
            ):
                path.unlink(missing_ok=True)
                total -= size
                count -= 1


cache = CertificateCache(DATA_ROOT / "cache" / "reception-certificates")
