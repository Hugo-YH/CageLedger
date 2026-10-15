"""Maintain exact source-to-target lookups alongside legacy transfer payloads."""

import json
from contextlib import contextmanager

from server_app.shared.quantity_transfer_links import extract_links


@contextmanager
def transfer_write(conn):
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    conn.execute("SAVEPOINT quantity_transfer_index")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK TO quantity_transfer_index")
        conn.execute("RELEASE quantity_transfer_index")
        raise
    else:
        conn.execute("RELEASE quantity_transfer_index")


def has_index(conn):
    return bool(
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='quantity_sheet_transfer_links'"
        ).fetchone()
    )


def replace_links(conn, sheet):
    identity = sheet["id"]
    conn.execute("DELETE FROM quantity_sheet_transfer_links WHERE target_sheet_id=?", (identity,))
    conn.executemany(
        """INSERT INTO quantity_sheet_transfer_links
        (target_sheet_id,target_row_id,link_key,source_sheet_id,source_row_id,direction,quantity)
        VALUES (?,?,?,?,?,?,?)""",
        [(identity, *link) for link in extract_links(sheet)],
    )
    conn.execute("DELETE FROM quantity_sheet_transfer_dirty WHERE sheet_id=?", (identity,))


def refresh_pending(conn):
    if not conn.execute("SELECT 1 FROM quantity_sheet_transfer_dirty LIMIT 1").fetchone():
        return 0
    with transfer_write(conn):
        rows = conn.execute("""SELECT sheets.id,sheets.payload FROM quantity_sheet_transfer_dirty AS dirty
            JOIN quantity_sheets AS sheets ON sheets.id=dirty.sheet_id ORDER BY sheets.rowid""").fetchall()
        for identity, payload in rows:
            sheet = json.loads(payload)
            replace_links(conn, {**sheet, "id": identity})
    return len(rows)


def select_target_sheets(conn, month, source_sheet_id, target_iacucs):
    targets = list(target_iacucs)
    if not has_index(conn):
        # Legacy standalone callers can read exact references without migrating.
        rows = conn.execute("SELECT payload FROM quantity_sheets WHERE month=? AND id<>?", (month, source_sheet_id))
        sheets = [json.loads(row[0]) for row in rows]
        return [
            sheet
            for sheet in sheets
            if sheet.get("iacuc") in targets or any(link[2] == source_sheet_id for link in extract_links(sheet))
        ]
    refresh_pending(conn)
    mirror = "id IN (SELECT target_sheet_id FROM quantity_sheet_transfer_links WHERE source_sheet_id=?)"
    params = [month, source_sheet_id]
    if targets:
        condition = f"(iacuc IN ({','.join('?' for _ in targets)}) OR {mirror})"
        params.extend(targets)
    else:
        condition = mirror
    params.append(source_sheet_id)
    rows = conn.execute(f"SELECT payload FROM quantity_sheets WHERE month=? AND id<>? AND {condition}", params)
    return [json.loads(row[0]) for row in rows]
