"""Explicit intake list projection; full records remain available for editing and printing."""

import json

from server_app.cache import cache_build_lock, cache_generation, cache_get, cache_key, cache_set
from server_app.runtime_logging import log_stage

FIELDS = (
    "id",
    "intakePurpose",
    "purchaseOrderNo",
    "batchNo",
    "iacuc",
    "supplier",
    "species",
    "strainRaw",
    "strainStandard",
    "sex",
    "notes",
    "quantity",
    "roomName",
    "intakeDate",
    "pi",
    "owner",
    "status",
    "finalCardCount",
    "confirmedCardCount",
    "remainingCardCount",
    "updatedAt",
)


def projection(column="payload"):
    # Names are a fixed application-owned whitelist, never request input.
    return f"json_extract({column}," + ",".join(f"'$.{field}'" for field in FIELDS) + ")"


def decode_summary(value):
    return dict(zip(FIELDS, json.loads(value), strict=True))


def page(conn, filters, where, params, order):
    database = next((row[2] for row in conn.execute("PRAGMA database_list") if row[1] == "main"), "")
    key = cache_key("intake_batches::summary", database=database, filters=filters)
    with cache_build_lock(key, conn):
        return _page(conn, filters, where, params, order, database, key)


def _page(conn, filters, where, params, order, database, key):
    _cache_generation = cache_generation()
    cached = cache_get(key, connection=conn) if database else None
    if cached is not None:
        return cached
    clause = f" WHERE {where}" if where else ""
    with log_stage("intake_list", "count", component="intake"):
        total = conn.execute(f"SELECT COUNT(*) FROM intake_batches{clause}", params).fetchone()[0]
    # Apply ordering/pagination to scalar columns first. In particular, a temp
    # sort must not parse every batch's cards/recognition payload to show 20 rows.
    with log_stage("intake_list", "page", component="intake"):
        rows = conn.execute(
            "WITH page AS MATERIALIZED (SELECT rowid page_rowid FROM intake_batches"
            f"{clause} ORDER BY {order} LIMIT ? OFFSET ?) "
            f"SELECT {projection('b.payload')} AS payload FROM page p "
            "JOIN intake_batches b ON b.rowid=p.page_rowid "
            f"ORDER BY {order.replace('rowid', 'b.rowid')}",
            (*params, filters["limit"], filters["offset"]),
        ).fetchall()
    return cache_set(
        key,
        {
            "items": [decode_summary(row["payload"]) for row in rows],
            "page": {
                "limit": filters["limit"],
                "offset": filters["offset"],
                "total": total,
                "hasMore": filters["offset"] + filters["limit"] < total,
            },
        },
        expected_generation=_cache_generation if database and conn.in_transaction is not True else -1,
    )
