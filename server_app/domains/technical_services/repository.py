"""Indexed service sheets, daily rows and immutable creation receipts."""

import json

from server_app.domains.workflow.constants import FROZEN_WORKFLOW_STATUSES
from server_app.shared.concurrency import StaleWriteError as StaleWriteError
from server_app.shared.concurrency import require_exact_version

from . import listing

SOURCE_TYPE = "pi_merged_technical_service"


def ensure_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS technical_service_catalog (
            id TEXT NOT NULL, version TEXT NOT NULL, payload TEXT NOT NULL,
            PRIMARY KEY(id, version));
        CREATE TABLE IF NOT EXISTS technical_service_sheets (
            id TEXT PRIMARY KEY, month TEXT NOT NULL, iacuc TEXT NOT NULL, pi TEXT NOT NULL,
            facility TEXT NOT NULL, service_id TEXT NOT NULL, customer_type TEXT NOT NULL,
            total_cents INTEGER NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
            creation_signature TEXT NOT NULL, created_by TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS technical_service_scope
            ON technical_service_sheets(month, iacuc, facility, service_id, customer_type) WHERE deleted=0;
        CREATE INDEX IF NOT EXISTS technical_service_month_pi ON technical_service_sheets(month, pi, deleted);
        CREATE TABLE IF NOT EXISTS technical_service_rows (
            sheet_id TEXT NOT NULL REFERENCES technical_service_sheets(id), date TEXT NOT NULL,
            quantity TEXT NOT NULL, amount_cents INTEGER NOT NULL, PRIMARY KEY(sheet_id, date));
    """)
    from .catalog import CATALOG

    for item in CATALOG:
        conn.execute(
            "INSERT OR IGNORE INTO technical_service_catalog VALUES(?,?,?)",
            (item["id"], item["version"], json.dumps(item, ensure_ascii=False)),
        )


def catalog(conn):
    from .catalog import VERSION

    return [
        json.loads(r[0])
        for r in conn.execute(
            "SELECT payload FROM technical_service_catalog WHERE version=? ORDER BY rowid", (VERSION,)
        )
    ]


def get(conn, identity, *, include_deleted=False):
    row = conn.execute("SELECT * FROM technical_service_sheets WHERE id=?", (identity,)).fetchone()
    if not row or (row["deleted"] and not include_deleted):
        raise LookupError("技术服务明细不存在")
    return row, json.loads(row["payload"])


def protected_ids(conn):
    placeholders = ",".join("?" for _ in FROZEN_WORKFLOW_STATUSES)
    rows = conn.execute(
        f"""SELECT v.payload, v.version_status FROM billing_workflows w
        LEFT JOIN billing_statement_versions v ON v.id=w.current_version_id
        WHERE w.source_type=? AND w.workflow_status IN ({placeholders})""",
        [SOURCE_TYPE, *FROZEN_WORKFLOW_STATUSES],
    ).fetchall()
    if any(not row[0] or row["version_status"] != "active" for row in rows):
        raise ValueError("已发起技术服务结算版本缺失，请核查历史记录")
    return {identity for row in rows for identity in json.loads(row[0]).get("statement", {}).get("sourceIds", [])}


def list_sheets(conn, filters, *, all_rows=False):
    protected = protected_ids(conn)
    base, base_values = listing.sheet_base(protected)
    where, values = listing.sheet_where(filters)
    params = [*base_values, *values]
    total = conn.execute(f"SELECT COUNT(*) FROM ({base}) WHERE {where}", params).fetchone()[0]
    limit, offset = listing.pagination(filters)
    sort = listing.order(filters, listing.SHEET_COLUMNS, "month DESC, iacuc")
    suffix = "" if all_rows else " LIMIT ? OFFSET ?"
    rows = conn.execute(
        f"SELECT payload FROM ({base}) WHERE {where} ORDER BY {sort}, id{suffix}",
        params if all_rows else [*params, limit, offset],
    ).fetchall()
    return {
        "items": [{**json.loads(r[0]), "protected": json.loads(r[0])["id"] in protected} for r in rows],
        "page": listing.page(total, limit, offset),
    }


def sheet_filter_options(conn, filters):
    base, values = listing.sheet_base(protected_ids(conn))
    return listing.filter_options(
        conn, filters, base=base, base_values=values, allowed=listing.SHEET_COLUMNS, where=listing.sheet_where
    )


def require_version(row, expected):
    require_exact_version(row["updated_at"] if expected else None, expected, "技术服务明细已更新，请刷新后重新编辑。")


def candidate_scopes(conn, filters):
    """Filter and page complete PI aggregates before loading statement inputs."""
    base, base_values = listing.candidate_base(SOURCE_TYPE)
    where, values = listing.candidate_where(filters)
    params = [*base_values, *values]
    total = conn.execute(f"SELECT COUNT(*) FROM ({base}) WHERE {where}", params).fetchone()[0]
    limit, offset = listing.pagination(filters)
    sort = listing.order(filters, listing.CANDIDATE_COLUMNS, "month DESC, pi COLLATE NOCASE")
    scopes = conn.execute(
        f"SELECT month, pi FROM ({base}) WHERE {where} ORDER BY {sort}, month, pi LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()
    return scopes, listing.page(total, limit, offset)


def candidate_filter_options(conn, filters):
    protected_ids(conn)
    base, values = listing.candidate_base(SOURCE_TYPE)
    return listing.filter_options(
        conn, filters, base=base, base_values=values, allowed=listing.CANDIDATE_COLUMNS, where=listing.candidate_where
    )


def put(conn, item, signature, actor_id):
    conn.execute(
        """INSERT INTO technical_service_sheets
        (id, month, iacuc, pi, facility, service_id, customer_type, total_cents, updated_at,
         creation_signature, created_by, payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET month=excluded.month, iacuc=excluded.iacuc, pi=excluded.pi,
        facility=excluded.facility, service_id=excluded.service_id, customer_type=excluded.customer_type,
        total_cents=excluded.total_cents, updated_at=excluded.updated_at, payload=excluded.payload""",
        (
            item["id"],
            item["month"],
            item["iacuc"],
            item["pi"],
            item["facility"],
            item["serviceId"],
            item["customerType"],
            round(item["totalAmount"] * 100),
            item["updatedAt"],
            signature,
            actor_id,
            json.dumps(item, ensure_ascii=False, allow_nan=False),
        ),
    )
    conn.execute("DELETE FROM technical_service_rows WHERE sheet_id=?", (item["id"],))
    conn.executemany(
        "INSERT INTO technical_service_rows VALUES(?,?,?,?)",
        [(item["id"], r["date"], str(r["quantity"]), round(r["amount"] * 100)) for r in item["rows"]],
    )
