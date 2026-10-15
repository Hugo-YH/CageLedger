"""SQL adapters for compressed bill details and their legacy JSON summaries."""

import json
from contextlib import contextmanager

from server_app.domains.billing.snapshot_codec import (
    CODEC,
    STORAGE_MARKER,
    SnapshotStorageError,
    decode_records,
    encode_records,
    summary_payload,
)


@contextmanager
def snapshot_write(conn):
    if not conn.in_transaction:
        conn.execute("BEGIN")
    conn.execute("SAVEPOINT bill_snapshot_storage")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK TO bill_snapshot_storage")
        conn.execute("RELEASE bill_snapshot_storage")
        raise
    else:
        conn.execute("RELEASE bill_snapshot_storage")


def stored_block(conn, version_id):
    if not conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='billing_statement_line_blocks'"
    ).fetchone():
        return None
    row = conn.execute(
        "SELECT codec,raw_bytes,raw_sha256,line_count,payload FROM billing_statement_line_blocks WHERE version_id=?",
        (version_id,),
    ).fetchone()
    return dict(zip(("codec", "raw_bytes", "raw_sha256", "line_count", "payload"), row, strict=False)) if row else None


def read_records(conn, version_id):
    rows = [
        list(row)
        for row in conn.execute(
            "SELECT id,line_date,payload FROM billing_statement_version_lines WHERE version_id=? ORDER BY line_date,rowid",
            (version_id,),
        )
    ]
    block = stored_block(conn, version_id)
    if block:
        records = decode_records(version_id, block)
        if len(records) != len(rows) or any(
            record[:2] != row[:2] or summary_payload(record[2]) != row[2]
            for record, row in zip(records, rows, strict=False)
        ):
            raise SnapshotStorageError("账单快照摘要与压缩块不一致，不能使用实时数据替代")
        return records
    if any(STORAGE_MARKER in json.loads(row[2]) for row in rows):
        raise SnapshotStorageError("账单快照压缩块缺失，不能使用实时数据替代")
    return rows


def insert_records(conn, version_id, records):
    block = encode_records(version_id, records)
    conn.execute("DELETE FROM billing_statement_line_blocks WHERE version_id=?", (version_id,))
    for index, (identity, date, payload) in enumerate(records):
        conn.execute(
            "INSERT INTO billing_statement_version_lines(id,version_id,line_date,payload) VALUES (?,?,?,?)",
            (identity, version_id, date, block["summaries"][index] if block else payload),
        )
    if block:
        store_block(conn, version_id, block)


def store_block(conn, version_id, block):
    conn.execute(
        """INSERT INTO billing_statement_line_blocks(version_id,codec,raw_bytes,raw_sha256,line_count,payload)
        VALUES (?,?,?,?,?,?)""",
        (version_id, block["codec"], block["raw_bytes"], block["raw_sha256"], block["line_count"], block["payload"]),
    )


def compact_version(conn, version_id):
    records = read_records(conn, version_id)
    if stored_block(conn, version_id):
        return False
    block = encode_records(version_id, records)
    if not block:
        return False
    with snapshot_write(conn):
        for record, summary in zip(records, block["summaries"], strict=False):
            conn.execute(
                "UPDATE billing_statement_version_lines SET payload=? WHERE id=? AND version_id=?",
                (summary, record[0], version_id),
            )
        store_block(conn, version_id, block)
    return True


def expand_version(conn, version_id):
    records = read_records(conn, version_id)
    if not stored_block(conn, version_id):
        return False
    with snapshot_write(conn):
        for identity, _, payload in records:
            conn.execute(
                "UPDATE billing_statement_version_lines SET payload=? WHERE id=? AND version_id=?",
                (payload, identity, version_id),
            )
        conn.execute("DELETE FROM billing_statement_line_blocks WHERE version_id=?", (version_id,))
    return True


def validate_summary_storage(conn, version_id):
    markers = conn.execute(
        """SELECT json_extract(payload, '$._snapshotStorage'),count(*)
        FROM billing_statement_version_lines WHERE version_id=? GROUP BY 1""",
        (version_id,),
    ).fetchall()
    block = stored_block(conn, version_id)
    if block:
        if block["codec"] != CODEC or len(markers) != 1 or tuple(markers[0]) != (CODEC, block["line_count"]):
            raise SnapshotStorageError("账单快照摘要与压缩块不一致")
    elif any(row[0] is not None for row in markers):
        raise SnapshotStorageError("账单快照压缩块缺失")


def delete_workflow_snapshot_data(conn, workflow_id):
    for table in ("billing_statement_line_blocks", "billing_statement_version_lines"):
        conn.execute(
            f"DELETE FROM {table} WHERE version_id IN (SELECT id FROM billing_statement_versions WHERE workflow_id=?)",
            (workflow_id,),
        )
