"""Bounded cache of previously verified audit list projections."""

import hashlib
import json
from collections import OrderedDict
from threading import Lock

_CACHE = OrderedDict()
_LOCK = Lock()
_LIMIT = 512
_MAX_ENTRY_BYTES = 256 * 1024


def fingerprint(identity, stored, block):
    digest = hashlib.sha256()
    values = (identity, stored, block is not None)
    if block is not None:
        values += (block["codec"], block["raw_bytes"], block["raw_sha256"], block["payload"])
    for value in values:
        if isinstance(value, bytes | bytearray | memoryview):
            data = bytes(value)
        elif isinstance(value, str):
            data = value.encode("utf-8")
        else:
            data = repr(value).encode("utf-8")
        tag = type(value).__name__.encode("ascii")
        digest.update(len(tag).to_bytes(4, "big"))
        digest.update(tag)
        digest.update(len(data).to_bytes(8, "big"))
        digest.update(data)
    return digest.digest()


def get(key):
    with _LOCK:
        value = _CACHE.get(key)
        if value is not None:
            _CACHE.move_to_end(key)
    return json.loads(value) if value is not None else None


def put(key, item):
    value = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
    # Bound memory even for historical events with exceptionally long string fields.
    if len(value.encode("utf-8")) > _MAX_ENTRY_BYTES:
        return
    with _LOCK:
        _CACHE[key] = value
        _CACHE.move_to_end(key)
        if len(_CACHE) > _LIMIT:
            _CACHE.popitem(last=False)
