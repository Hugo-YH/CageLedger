"""Lossless bill snapshot encoding; financial values are never recalculated."""

import hashlib
import json
import zlib

CODEC = "zlib-json-v1"
STORAGE_MARKER = "_snapshotStorage"
MAX_RAW_BYTES = 128 * 1024 * 1024
SUMMARY_KEYS = frozenset(
    (
        "id",
        "date",
        "versionId",
        "cageCount",
        "animalCount",
        "freeCages",
        "billableCages",
        "billableCount",
        "amount",
        "cumulative",
    )
)


class SnapshotStorageError(ValueError):
    pass


def summary_payload(payload):
    try:
        line = json.loads(payload)
        if not isinstance(line, dict) or STORAGE_MARKER in line:
            raise ValueError("invalid detail")
        return json.dumps(
            {**{key: value for key, value in line.items() if key in SUMMARY_KEYS}, STORAGE_MARKER: CODEC},
            ensure_ascii=False,
            separators=(",", ":"),
        )
    except (ValueError, TypeError) as exc:
        raise SnapshotStorageError("账单快照明细格式无效，不能压缩") from exc


def encode_records(version_id, records):
    summaries = [summary_payload(record[2]) for record in records]
    original_bytes = sum(len(record[2].encode("utf-8")) for record in records)
    if original_bytes < 2048:
        return None
    raw = json.dumps({"versionId": version_id, "records": records}, ensure_ascii=False, separators=(",", ":")).encode()
    if len(raw) > MAX_RAW_BYTES:
        return None
    block = zlib.compress(raw, level=6)
    projected_bytes = sum(len(value.encode()) for value in summaries)
    if len(block) + projected_bytes >= original_bytes * 0.9:
        return None
    return {
        "codec": CODEC,
        "raw_bytes": len(raw),
        "raw_sha256": hashlib.sha256(raw).hexdigest(),
        "line_count": len(records),
        "payload": block,
        "summaries": summaries,
    }


def decode_records(version_id, block):
    try:
        size = block["raw_bytes"]
        if block["codec"] != CODEC or not 0 < size <= MAX_RAW_BYTES:
            raise ValueError("unsupported snapshot encoding")
        decoder = zlib.decompressobj()
        raw = decoder.decompress(block["payload"], size + 1)
        if len(raw) != size or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
            raise ValueError("invalid compressed snapshot")
        if hashlib.sha256(raw).hexdigest() != block["raw_sha256"]:
            raise ValueError("snapshot checksum mismatch")
        document = json.loads(raw)
        records = document["records"]
        if document["versionId"] != version_id or not isinstance(records, list) or len(records) != block["line_count"]:
            raise ValueError("snapshot version/count mismatch")
        if any(
            not isinstance(row, list) or len(row) != 3 or not all(isinstance(v, str) for v in row) for row in records
        ):
            raise ValueError("invalid snapshot records")
        if len({row[0] for row in records}) != len(records):
            raise ValueError("duplicate snapshot rows")
        return records
    except (ValueError, TypeError, KeyError, UnicodeError, zlib.error) as exc:
        raise SnapshotStorageError("账单快照压缩块校验失败，不能使用实时数据替代") from exc
