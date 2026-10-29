"""Compatibility readers and transactional conversion of business audit JSON."""

import json
from contextlib import contextmanager

from server_app.shared.audit_codec import MARKER, AuditStorageError, decode_payload, encode_payload, summary_payload


@contextmanager
def audit_write(conn):
    if not conn.in_transaction:
        conn.execute("BEGIN")
    conn.execute("SAVEPOINT audit_payload_storage")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK TO audit_payload_storage")
        conn.execute("RELEASE audit_payload_storage")
        raise
    else:
        conn.execute("RELEASE audit_payload_storage")


def has_storage(conn):
    return bool(
        conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='audit_event_payload_blocks'").fetchone()
    )


def payloads_for_rows(conn, rows):
    rows = list(rows)
    blocks = {}
    if rows and has_storage(conn):
        ids = [row[0] for row in rows]
        for offset in range(0, len(ids), 400):
            batch = ids[offset : offset + 400]
            for row in conn.execute(
                f"SELECT event_id,codec,raw_bytes,raw_sha256,payload FROM audit_event_payload_blocks WHERE event_id IN ({','.join('?' for _ in batch)})",
                batch,
            ):
                blocks[row[0]] = dict(zip(("codec", "raw_bytes", "raw_sha256", "payload"), row[1:], strict=True))
    result = []
    for identity, stored in rows:
        if identity in blocks:
            payload = decode_payload(identity, blocks[identity])
            if summary_payload(payload) != stored:
                raise AuditStorageError("审计摘要与压缩详情不一致")
        else:
            payload = stored
            if MARKER in json.loads(stored):
                raise AuditStorageError("审计详情压缩块缺失")
        result.append(payload)
    return result


def list_summaries_for_rows(conn, rows):
    """Validate the complete stored inputs before reusing a bounded projection."""
    from . import audit_list_cache as cache

    rows = list(rows)
    blocks = {}
    if rows and has_storage(conn):
        ids = [row[0] for row in rows]
        for offset in range(0, len(ids), 400):
            batch = ids[offset : offset + 400]
            for row in conn.execute(
                f"SELECT event_id,codec,raw_bytes,raw_sha256,payload FROM audit_event_payload_blocks WHERE event_id IN ({','.join('?' for _ in batch)})",
                batch,
            ):
                blocks[row[0]] = dict(zip(("codec", "raw_bytes", "raw_sha256", "payload"), row[1:], strict=True))
    result = []
    for identity, stored in rows:
        block = blocks.get(identity)
        key = cache.fingerprint(identity, stored, block)
        item = cache.get(key)
        if item is None:
            if block is not None:
                payload = decode_payload(identity, block)
                if summary_payload(payload) != stored:
                    raise AuditStorageError("审计摘要与压缩详情不一致")
                item = json.loads(stored)
                del item[MARKER]
            else:
                item = json.loads(stored)
                if MARKER in item:
                    raise AuditStorageError("审计详情压缩块缺失")
                for field in ("before", "after"):
                    value = item.get(field)
                    if isinstance(value, dict):
                        item[field] = {"truncated": True, "entityKeys": sorted(value.keys())}
                    elif isinstance(value, list):
                        item[field] = {"truncated": True, "count": len(value)}
            cache.put(key, item)
        result.append(item)
    return result


def read_payload(conn, identity):
    row = conn.execute("SELECT id,payload FROM audit_events WHERE id=?", (identity,)).fetchone()
    if not row:
        raise LookupError("审计记录不存在")
    return payloads_for_rows(conn, [row])[0]


def compact_event(conn, identity):
    if not has_storage(conn):
        return False
    payload = read_payload(conn, identity)
    if conn.execute("SELECT 1 FROM audit_event_payload_blocks WHERE event_id=?", (identity,)).fetchone():
        return False
    block = encode_payload(identity, payload)
    if not block:
        return False
    with audit_write(conn):
        conn.execute("UPDATE audit_events SET payload=? WHERE id=?", (block["summary"], identity))
        conn.execute(
            "INSERT INTO audit_event_payload_blocks(event_id,codec,raw_bytes,raw_sha256,payload) VALUES (?,?,?,?,?)",
            (identity, block["codec"], block["raw_bytes"], block["raw_sha256"], block["payload"]),
        )
    return True


def expand_event(conn, identity):
    payload = read_payload(conn, identity)
    if (
        not has_storage(conn)
        or not conn.execute("SELECT 1 FROM audit_event_payload_blocks WHERE event_id=?", (identity,)).fetchone()
    ):
        return False
    with audit_write(conn):
        conn.execute("UPDATE audit_events SET payload=? WHERE id=?", (payload, identity))
        conn.execute("DELETE FROM audit_event_payload_blocks WHERE event_id=?", (identity,))
    return True
