import json

from server_app.cache import CACHE_MISS, cache_generation, cache_get, cache_key, cache_set
from server_app.repositories.person_names import (
    column_predicate,
    individual_mode,
    person_options,
    prepare_person_filters,
)

from .quantity_transfer_links import has_index, replace_links, select_target_sheets, transfer_write

QUANTITY_SHEET_LIST_COLUMNS = {
    "month": {"expr": "month", "order": "month"},
    "iacuc": {"expr": "iacuc", "order": "iacuc"},
    "roomName": {"expr": "room_name", "order": "room_name"},
    "manager": {"expr": "manager", "order": "manager"},
    "pi": {"expr": "pi", "order": "pi"},
    "updatedAt": {"expr": "updated_at", "order": "updated_at"},
}


def list_quantity_sheets(conn):
    rows = conn.execute("SELECT payload FROM quantity_sheets ORDER BY month DESC, iacuc, updated_at DESC").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def find_latest_quantity_sheet_pi(conn, iacuc, before_month):
    row = conn.execute(
        """
        SELECT month, pi
        FROM quantity_sheets
        WHERE iacuc = ? AND month < ?
        ORDER BY month DESC, updated_at DESC, rowid DESC
        LIMIT 1
        """,
        (iacuc, before_month),
    ).fetchone()
    if not row:
        return None
    return {"month": row["month"], "pi": row["pi"]}


def list_quantity_sheets_by_month(conn, month):
    rows = conn.execute(
        """
        SELECT payload
        FROM quantity_sheets
        WHERE month = ?
        ORDER BY pi, iacuc, room_name, updated_at DESC, rowid DESC
        """,
        (month,),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_quantity_sheets_page(conn, filters, filtered_where):
    _cache_generation = cache_generation()
    where, params = quantity_sheet_where(filters, filtered_where, conn=conn)
    order_by = quantity_sheet_order_by(filters)
    key = cache_key(
        "quantity_sheets",
        limit=filters["limit"],
        offset=filters["offset"],
        sort_key=str(filters.get("sortKey", "")).strip(),
        sort_dir=str(filters.get("sortDir", "")).strip(),
        column_filters=filters.get("columnFilters", {}),
        person_filter_mode=filters.get("personFilterMode", ""),
        month=str(filters.get("month", "")).strip(),
        iacuc=str(filters.get("iacuc", "")).strip(),
        pi=str(filters.get("pi", "")).strip(),
        room_id=str(filters.get("roomId", "")).strip(),
    )
    cached = cache_get(key, connection=conn)
    if cached is not None:
        return cached
    where_clause = f" WHERE {where}" if where else ""
    total = conn.execute(f"SELECT COUNT(*) AS total FROM quantity_sheets{where_clause}", params).fetchone()["total"]
    rows = conn.execute(
        f"""
        SELECT
            id,
            month,
            iacuc,
            room_id,
            room_name,
            manager,
            project,
            pi,
            owner,
            funding,
            updated_at,
            json_extract(payload, '$.contact') AS contact,
            json_extract(payload, '$.roomManager') AS room_manager,
            json_extract(payload, '$.initialCageCount') AS initial_cage_count,
            json_extract(payload, '$.initialAnimalCount') AS initial_animal_count,
            json_extract(payload, '$.billingUnit') AS billing_unit
        FROM quantity_sheets{where_clause}
        ORDER BY {order_by}
        LIMIT ? OFFSET ?
        """,
        (*params, filters["limit"], filters["offset"]),
    ).fetchall()
    payload = {
        "items": [quantity_sheet_list_row(row) for row in rows],
        "page": {
            "limit": filters["limit"],
            "offset": filters["offset"],
            "total": total,
            "hasMore": filters["offset"] + filters["limit"] < total,
        },
    }
    return cache_set(key, payload, expected_generation=_cache_generation if conn.in_transaction is not True else -1)


def quantity_sheet_where(filters, filtered_where, exclude_column="", conn=None):
    if conn is not None:
        filters = prepare_person_filters(conn, filters, "quantity_sheets", {"pi": "pi"}, exclude=exclude_column)
    where, params = filtered_where(
        [
            ("month", "month = ?"),
            ("iacuc", "iacuc = ?"),
            ("pi", "pi = ?"),
            ("roomId", "room_id = ?"),
        ],
        filters,
    )
    where_parts = [where] if where else []
    next_params = list(params)
    for key, values in (filters.get("columnFilters") or {}).items():
        if key == exclude_column:
            continue
        spec = QUANTITY_SHEET_LIST_COLUMNS.get(key)
        cleaned = [
            str(value).strip()
            for value in values
            if str(value).strip() or (key in {"month", "updatedAt"} and value == "")
        ]
        if not spec or not cleaned:
            continue
        clause, values = column_predicate(filters, key, f"COALESCE({spec['expr']}, '')", cleaned)
        where_parts.append(clause)
        next_params.extend(values)
    return " AND ".join(where_parts), tuple(next_params)


def quantity_sheet_order_by(filters):
    sort_key = str(filters.get("sortKey", "") or "").strip()
    sort_dir = "ASC" if str(filters.get("sortDir", "") or "").lower() == "asc" else "DESC"
    spec = QUANTITY_SHEET_LIST_COLUMNS.get(sort_key)
    if not spec:
        return "month DESC, iacuc, updated_at DESC"
    return f"{spec['order']} {sort_dir}, rowid DESC"


def list_quantity_sheet_filter_options(conn, filters, filtered_where, column):
    spec = QUANTITY_SHEET_LIST_COLUMNS.get(column)
    if not spec:
        return {"items": []}
    where, params = quantity_sheet_where(filters, filtered_where, exclude_column=column, conn=conn)
    where_clause = f" WHERE {where}" if where else ""
    limit = "" if column in {"month", "updatedAt"} or individual_mode(filters, column) else "LIMIT 500"
    rows = conn.execute(
        f"""
        SELECT COALESCE({spec["expr"]}, '') AS value, COUNT(*) AS count
        FROM quantity_sheets{where_clause}
        GROUP BY value
        ORDER BY value COLLATE NOCASE
        {limit}
        """,
        params,
    ).fetchall()
    result = {
        "items": [
            {"value": row["value"] or "", "label": row["value"] or "空白", "count": row["count"]} for row in rows
        ],
    }

    result["items"] = person_options(filters, column, result["items"])
    return result


def quantity_sheet_list_row(row):
    return {
        "id": row["id"] or "",
        "month": row["month"] or "",
        "iacuc": row["iacuc"] or "",
        "roomId": row["room_id"] or "",
        "roomName": row["room_name"] or "",
        "manager": row["manager"] or "",
        "roomManager": row["room_manager"] or "",
        "project": row["project"] or "",
        "pi": row["pi"] or "",
        "owner": row["owner"] or "",
        "contact": row["contact"] or "",
        "funding": row["funding"] or "",
        "initialCageCount": row["initial_cage_count"] or 0,
        "initialAnimalCount": row["initial_animal_count"] or 0,
        "billingUnit": row["billing_unit"] or "",
        "updatedAt": row["updated_at"] or "",
    }


def quantity_sheet_list_item(sheet):
    return {
        "id": sheet.get("id", ""),
        "month": sheet.get("month", ""),
        "iacuc": sheet.get("iacuc", ""),
        "roomId": sheet.get("roomId", ""),
        "roomName": sheet.get("roomName", ""),
        "manager": sheet.get("manager", ""),
        "roomManager": sheet.get("roomManager", ""),
        "project": sheet.get("project", ""),
        "pi": sheet.get("pi", ""),
        "owner": sheet.get("owner", ""),
        "contact": sheet.get("contact", ""),
        "funding": sheet.get("funding", ""),
        "initialCageCount": sheet.get("initialCageCount", 0),
        "initialAnimalCount": sheet.get("initialAnimalCount", 0),
        "billingUnit": sheet.get("billingUnit", ""),
        "updatedAt": sheet.get("updatedAt", ""),
    }


def get_quantity_sheet(conn, sheet_id):
    _cache_generation = cache_generation()
    key = cache_key("quantity_sheets::detail", id=sheet_id)
    cached = cache_get(key, CACHE_MISS, connection=conn)
    if cached is not CACHE_MISS:
        return cached
    return cache_set(
        key,
        get_quantity_sheet_for_write(conn, sheet_id),
        expected_generation=_cache_generation if conn.in_transaction is not True else -1,
    )


def get_quantity_sheet_for_write(conn, sheet_id):
    """Read the transaction's actual row; cached detail is never a write version."""
    row = conn.execute("SELECT payload FROM quantity_sheets WHERE id = ?", (sheet_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def list_quantity_sheets_by_month_iacuc(conn, month, iacuc):
    rows = conn.execute(
        """
        SELECT payload
        FROM quantity_sheets
        WHERE month = ? AND iacuc = ?
        ORDER BY updated_at DESC, rowid DESC
        """,
        (month, iacuc),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_quantity_sheets_by_month_pi(conn, month, pi):
    rows = conn.execute(
        """
        SELECT payload
        FROM quantity_sheets
        WHERE month = ? AND pi = ?
        ORDER BY updated_at DESC, rowid DESC
        """,
        (month, pi),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def insert_quantity_sheet(conn, sheet, db_values):
    with transfer_write(conn):
        conn.execute(
            """
            INSERT INTO quantity_sheets (
                month, iacuc, room_id, room_name, manager, project, pi, owner,
                funding, updated_at, payload, id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            db_values + (sheet["id"],),
        )
        if has_index(conn):
            replace_links(conn, sheet)


def update_quantity_sheet(conn, sheet, db_values):
    with transfer_write(conn):
        conn.execute(
            """
            UPDATE quantity_sheets
            SET month = ?, iacuc = ?, room_id = ?, room_name = ?, manager = ?,
                project = ?, pi = ?, owner = ?, funding = ?, updated_at = ?, payload = ?
            WHERE id = ?
            """,
            db_values + (sheet["id"],),
        )
        if has_index(conn):
            replace_links(conn, sheet)


def delete_quantity_sheet_by_id(conn, sheet_id):
    conn.execute("DELETE FROM quantity_sheets WHERE id = ?", (sheet_id,))


def select_quantity_sheets_for_transfer(conn, month, source_sheet_id, target_iacucs, source_row_ids):
    # Include references to removed rows too: cleanup removes every contribution
    # from this source before rebuilding the current transfers.
    return select_target_sheets(conn, month, source_sheet_id, target_iacucs)
