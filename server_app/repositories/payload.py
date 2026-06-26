import json

from server_app.cache import cache_get, cache_key, cache_set


def dump_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def read_payloads(conn, table, order_by):
    rows = conn.execute(f"SELECT payload FROM {table} ORDER BY {order_by}").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def paginated_payloads(conn, table, order_by, where_sql="", params=(), limit=200, offset=0):
    where_clause = f" WHERE {where_sql}" if where_sql else ""
    total = conn.execute(f"SELECT COUNT(*) AS total FROM {table}{where_clause}", params).fetchone()["total"]
    rows = conn.execute(
        f"SELECT payload FROM {table}{where_clause} ORDER BY {order_by} LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()
    return {
        "items": [json.loads(row["payload"]) for row in rows],
        "page": {
            "limit": limit,
            "offset": offset,
            "total": total,
            "hasMore": offset + limit < total,
        },
    }


def cached_paginated_payloads(conn, cache_prefix, table, order_by, filters, where_sql="", params=()):
    key = cache_key(
        cache_prefix,
        limit=filters["limit"],
        offset=filters["offset"],
        sort_key=_clean(filters.get("sortKey", "")),
        sort_dir=_clean(filters.get("sortDir", "")),
        column_filters=filters.get("columnFilters", {}),
        status=_clean(filters.get("status", "")),
        month=_clean(filters.get("month", "")),
        iacuc=_clean(filters.get("iacuc", "")),
        pi=_clean(filters.get("pi", "")),
        room_id=_clean(filters.get("roomId", "")),
        room_ids=filters.get("roomIds", []),
        room_name=_clean(filters.get("roomName", "")),
        source_type=_clean(filters.get("sourceType", "")),
    )
    cached = cache_get(key)
    if cached is not None:
        return cached
    return cache_set(key, paginated_payloads(conn, table, order_by, where_sql, params, filters["limit"], filters["offset"]))


def set_setting(conn, key, value, updated_at):
    conn.execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, json.dumps(value, ensure_ascii=False), updated_at),
    )


def read_setting(conn, key, default):
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    if not row:
        return default
    return json.loads(row["value"])


def read_updated_at(conn):
    row = conn.execute("SELECT MAX(updated_at) AS updated_at FROM app_settings").fetchone()
    return row["updated_at"] if row else None


def table_has_rows(conn, table):
    row = conn.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone()
    return row is not None


def _clean(value):
    return str(value or "").strip()
