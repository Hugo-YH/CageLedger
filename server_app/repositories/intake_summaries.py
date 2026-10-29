"""Explicit intake list projection; full records remain available for editing and printing."""

import json

from server_app.cache import cache_generation, cache_get, cache_key, cache_set

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
    _cache_generation = cache_generation()
    key = cache_key("intake_batches::summary", filters=filters)
    cached = cache_get(key, connection=conn)
    if cached is not None:
        return cached
    clause = f" WHERE {where}" if where else ""
    total = conn.execute(f"SELECT COUNT(*) FROM intake_batches{clause}", params).fetchone()[0]
    rows = conn.execute(
        f"SELECT {projection()} AS payload FROM intake_batches{clause} ORDER BY {order} LIMIT ? OFFSET ?",
        (*params, filters["limit"], filters["offset"]),
    )
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
        expected_generation=_cache_generation if conn.in_transaction is not True else -1,
    )
