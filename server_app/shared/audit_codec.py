"""Lossless, identity-bound compression of large business audit JSON."""

import hashlib
import json
import zlib

CODEC = "zlib-audit-json-v1"
MARKER = "_auditStorage"
MAX_RAW_BYTES = 128 * 1024 * 1024


class AuditStorageError(ValueError):
    pass


def summary_payload(payload):
    event = json.loads(payload)
    if not isinstance(event, dict) or MARKER in event:
        raise AuditStorageError("审计JSON结构无效")
    for key in ("before", "after"):
        value = event.get(key)
        if isinstance(value, dict):
            event[key] = {"truncated": True, "entityKeys": sorted(value)}
        elif isinstance(value, list):
            event[key] = {"truncated": True, "count": len(value)}
    event[MARKER] = CODEC
    return json.dumps(event, ensure_ascii=False, separators=(",", ":"))


def encode_payload(identity, payload):
    summary = summary_payload(payload)
    original_bytes = len(payload.encode())
    if original_bytes < 2048:
        return None
    raw = json.dumps({"eventId": identity, "payload": payload}, ensure_ascii=False, separators=(",", ":")).encode()
    if len(raw) > MAX_RAW_BYTES:
        return None
    compressed = zlib.compress(raw, level=6)
    if len(compressed) + len(summary.encode()) >= original_bytes * 0.9:
        return None
    return {
        "codec": CODEC,
        "raw_bytes": len(raw),
        "raw_sha256": hashlib.sha256(raw).hexdigest(),
        "payload": compressed,
        "summary": summary,
    }


def decode_payload(identity, block):
    try:
        size = block["raw_bytes"]
        if block["codec"] != CODEC or not isinstance(size, int) or not 0 < size <= MAX_RAW_BYTES:
            raise ValueError("invalid codec or size")
        decoder = zlib.decompressobj()
        raw = decoder.decompress(block["payload"], size + 1)
        if len(raw) != size or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
            raise ValueError("invalid compressed stream")
        if hashlib.sha256(raw).hexdigest() != block["raw_sha256"]:
            raise ValueError("checksum mismatch")
        document = json.loads(raw)
        if document["eventId"] != identity or not isinstance(document["payload"], str):
            raise ValueError("identity or payload mismatch")
        summary_payload(document["payload"])
        return document["payload"]
    except (ValueError, TypeError, KeyError, UnicodeError, zlib.error) as exc:
        raise AuditStorageError("审计详情压缩块校验失败") from exc
