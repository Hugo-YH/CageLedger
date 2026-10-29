import json
import re

from server_app.cache import cache_generation, cache_get, cache_set
from server_app.repositories.person_names import (
    column_predicate,
    individual_mode,
    person_options,
    prepare_person_filters,
)
from server_app.shared.intake_identifiers import intake_identifier_values

from .payload import cached_paginated_payloads, dump_json

INTAKE_BATCH_LIST_COLUMNS = {
    "status": {"expr": "status", "order": "status"},
    "intakePurpose": {
        "expr": "COALESCE(json_extract(payload, '$.intakePurpose'), 'housing')",
        "order": "COALESCE(json_extract(payload, '$.intakePurpose'), 'housing')",
    },
    "batchNo": {"expr": "batch_no", "order": "batch_no"},
    "supplier": {"expr": "supplier", "order": "supplier"},
    "pi": {"expr": "pi", "order": "pi"},
    "owner": {"expr": "owner", "order": "owner"},
    "quantity": {"expr": "CAST(quantity AS TEXT)", "order": "quantity"},
    "roomName": {"expr": "room_name", "order": "room_name"},
    "intakeDate": {"expr": "intake_date", "order": "intake_date"},
    "cardCount": {
        "expr": "COALESCE(json_extract(payload, '$.confirmedCardCount'), 0) || ' / ' || COALESCE(card_count, 0) || ' 张'",
        "order": "card_count",
    },
}


def read_principal_identity_payloads(conn):
    rows = conn.execute("SELECT payload FROM principal_identities").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_distinct_principal_names(conn):
    principal_names = set()
    for table in ("experiment_applications", "quantity_sheets", "occupancies"):
        rows = conn.execute(f"SELECT DISTINCT pi FROM {table} WHERE TRIM(COALESCE(pi, '')) != ''").fetchall()
        principal_names.update(row["pi"] for row in rows if row["pi"])
    return principal_names


def read_principal_type_by_pi(conn):
    _cache_generation = cache_generation()
    cached = cache_get("principal_types_by_pi", connection=conn)
    if cached is not None:
        return cached
    rows = conn.execute(
        "SELECT pi, principal_type FROM principal_identities WHERE TRIM(COALESCE(pi, '')) != ''"
    ).fetchall()
    return cache_set(
        "principal_types_by_pi",
        {row["pi"]: row["principal_type"] for row in rows},
        expected_generation=_cache_generation if conn.in_transaction is not True else -1,
    )


def list_audit_events_page(conn, filters, filtered_where):
    where, params = filtered_where(
        [
            ("entityType", "entity_type = ?"),
            ("action", "action = ?"),
        ],
        filters,
    )
    from .audit_storage import list_summaries_for_rows

    where_clause = f" WHERE {where}" if where else ""
    total = conn.execute(f"SELECT COUNT(*) AS total FROM audit_events{where_clause}", params).fetchone()["total"]
    limit, offset = filters["limit"], filters["offset"]
    rows = conn.execute(
        f"SELECT id,payload FROM audit_events{where_clause} ORDER BY at DESC, rowid DESC LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()
    return {
        "items": list_summaries_for_rows(conn, rows),
        "page": {"limit": limit, "offset": offset, "total": total, "hasMore": offset + limit < total},
    }


def _trim_audit_snapshot(item):
    # List rows only render summary fields; bound full before/after snapshots so
    # large entity payloads do not inflate the audit page response.
    for key in ("before", "after"):
        value = item.get(key)
        if isinstance(value, dict):
            item[key] = {"truncated": True, "entityKeys": sorted(value.keys())}
        elif isinstance(value, list):
            item[key] = {"truncated": True, "count": len(value)}


def list_intake_batches_page(conn, filters, filtered_where, entity_order_by):
    where, params = intake_batch_where(filters, filtered_where, conn=conn)
    if filters.get("view") == "summary":
        from .intake_summaries import page

        return page(conn, filters, where, params, intake_batch_order_by(filters, entity_order_by))
    return cached_paginated_payloads(
        conn,
        "intake_batches",
        "intake_batches",
        intake_batch_order_by(filters, entity_order_by),
        filters,
        where,
        params,
    )


def intake_batch_where(filters, filtered_where, exclude_column="", conn=None):
    if conn is not None:
        filters = prepare_person_filters(
            conn, filters, "intake_batches", {"pi": "pi", "owner": "owner"}, exclude=exclude_column
        )
    status = str(filters.get("status", "") or "").strip()
    normalized_filters = dict(filters)
    if status in ("all", "unprinted"):
        normalized_filters.pop("status", None)
    where, params = filtered_where(
        [
            ("status", "status = ?"),
            ("iacuc", "iacuc = ?"),
            ("roomName", "room_name = ?"),
        ],
        normalized_filters,
    )
    if status == "unprinted":
        where = " AND ".join([part for part in (where, "status IN ('draft', 'pending_print')") if part])
    month = str(filters.get("month", "") or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}", month):
        year, month_number = (int(part) for part in month.split("-", 1))
        if 1 <= month_number <= 12:
            next_year = year + 1 if month_number == 12 else year
            next_month = 1 if month_number == 12 else month_number + 1
            where = " AND ".join([part for part in (where, "intake_date >= ? AND intake_date < ?") if part])
            params = (*params, f"{year:04d}-{month_number:02d}-01", f"{next_year:04d}-{next_month:02d}-01")
    where_parts = [where] if where else []
    next_params = list(params)
    for key, values in (filters.get("columnFilters") or {}).items():
        if key == exclude_column:
            continue
        spec = INTAKE_BATCH_LIST_COLUMNS.get(key)
        cleaned = [
            str(value).strip() for value in values if str(value).strip() or (key == "intakeDate" and value == "")
        ]
        if not spec or not cleaned:
            continue
        clause, values = column_predicate(filters, key, f"COALESCE({spec['expr']}, '')", cleaned)
        where_parts.append(clause)
        next_params.extend(values)
    return " AND ".join(where_parts), tuple(next_params)


def intake_batch_order_by(filters, entity_order_by):
    sort_key = str(filters.get("sortKey", "") or "").strip()
    sort_dir = "ASC" if str(filters.get("sortDir", "") or "").lower() == "asc" else "DESC"
    spec = INTAKE_BATCH_LIST_COLUMNS.get(sort_key)
    if not spec:
        return entity_order_by.get("intake_batches", "rowid")
    return f"{spec['order']} {sort_dir}, rowid DESC"


_INTAKE_STATUS_LABELS = {
    "draft": "草稿",
    "pending_print": "未打印",
    "pending_receipt": "待接收",
    "printed": "已打印",
    "received": "已接收",
}


def _intake_filter_label(column, value):
    text = str(value or "")
    if column == "status":
        return _INTAKE_STATUS_LABELS.get(text, text or "空白")
    return text or "空白"


def list_intake_batch_filter_options(conn, filters, filtered_where, column):
    spec = INTAKE_BATCH_LIST_COLUMNS.get(column)
    if not spec:
        return {"items": []}
    where, params = intake_batch_where(filters, filtered_where, exclude_column=column, conn=conn)
    where_clause = f" WHERE {where}" if where else ""
    limit = "" if column == "intakeDate" or individual_mode(filters, column) else "LIMIT 500"
    rows = conn.execute(
        f"""
        SELECT COALESCE({spec["expr"]}, '') AS value, COUNT(*) AS count
        FROM intake_batches{where_clause}
        GROUP BY value
        ORDER BY value COLLATE NOCASE
        {limit}
        """,
        params,
    ).fetchall()
    result = {
        "items": [
            {
                "value": row["value"] or "",
                "label": _intake_filter_label(column, row["value"]),
                "count": row["count"],
            }
            for row in rows
        ],
    }

    result["items"] = person_options(filters, column, result["items"])
    return result


def list_placement_tasks_page(conn, filters, entity_order_by, clean_text):
    where_parts = []
    params = []
    status = clean_text(filters.get("status", ""))
    if status == "open":
        where_parts.append("status NOT IN ('active', 'cancelled')")
    elif status:
        where_parts.append("status = ?")
        params.append(status)
    room_id = clean_text(filters.get("roomId", ""))
    if room_id:
        where_parts.append("target_room_id = ?")
        params.append(room_id)
    elif isinstance(filters.get("roomIds"), list):
        room_ids = [clean_text(item) for item in filters.get("roomIds", []) if clean_text(item)]
        if room_ids:
            where_parts.append(f"target_room_id IN ({', '.join('?' for _ in room_ids)})")
            params.extend(room_ids)
        else:
            where_parts.append("1 = 0")
    where = " AND ".join(where_parts)
    if filters.get("month"):
        where = " AND ".join([part for part in (where, "planned_move_in_date LIKE ?") if part])
        params = (*params, f"{filters['month']}%")
    return cached_paginated_payloads(
        conn,
        "placement_tasks",
        "placement_tasks",
        entity_order_by.get("placement_tasks", "rowid"),
        filters,
        where,
        params,
    )


def upsert_principal_identity(conn, pi_name, principal_type, updated_at, payload_json):
    conn.execute(
        """
        INSERT INTO principal_identities (pi, principal_type, updated_at, payload)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(pi) DO UPDATE SET
            principal_type = excluded.principal_type,
            updated_at = excluded.updated_at,
            payload = excluded.payload
        """,
        (pi_name, principal_type, updated_at, payload_json),
    )


def upsert_intake_batch(conn, batch):
    conn.execute(
        """
        INSERT INTO intake_batches (
            id, batch_no, iacuc, supplier, pi, owner, quantity, card_count,
            room_name, intake_date, status, updated_at, payload,
            purchase_order_no, purchase_order_key, batch_no_key
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            batch_no = excluded.batch_no,
            iacuc = excluded.iacuc,
            supplier = excluded.supplier,
            pi = excluded.pi,
            owner = excluded.owner,
            quantity = excluded.quantity,
            card_count = excluded.card_count,
            room_name = excluded.room_name,
            intake_date = excluded.intake_date,
            status = excluded.status,
            updated_at = excluded.updated_at,
            payload = excluded.payload,
            purchase_order_no = excluded.purchase_order_no,
            purchase_order_key = excluded.purchase_order_key,
            batch_no_key = excluded.batch_no_key
        """,
        (
            batch.get("id"),
            batch.get("batchNo", ""),
            batch.get("iacuc", ""),
            batch.get("supplier", ""),
            batch.get("pi", ""),
            batch.get("owner", ""),
            int(batch.get("quantity") or 0),
            int(batch.get("finalCardCount") or 0),
            batch.get("roomName", ""),
            batch.get("intakeDate", ""),
            batch.get("status", "draft"),
            batch.get("updatedAt", ""),
            dump_json(batch),
            *intake_identifier_values(batch),
        ),
    )


def delete_intake_batch(conn, batch_id):
    conn.execute("DELETE FROM intake_batches WHERE id = ?", (batch_id,))


def upsert_placement_task(conn, task):
    conn.execute(
        """
        INSERT INTO placement_tasks (
            id, source_batch_id, source_receipt_id, target_room_id, planned_move_in_date,
            status, reserved_occupancy_id, actual_move_in_date, updated_at, payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            source_batch_id = excluded.source_batch_id,
            source_receipt_id = excluded.source_receipt_id,
            target_room_id = excluded.target_room_id,
            planned_move_in_date = excluded.planned_move_in_date,
            status = excluded.status,
            reserved_occupancy_id = excluded.reserved_occupancy_id,
            actual_move_in_date = excluded.actual_move_in_date,
            updated_at = excluded.updated_at,
            payload = excluded.payload
        """,
        (
            task.get("id"),
            task.get("sourceBatchId", ""),
            task.get("sourceReceiptId", ""),
            task.get("targetRoomId", ""),
            task.get("plannedMoveInDate", ""),
            task.get("status", "pending"),
            task.get("reservedOccupancyId", ""),
            task.get("actualMoveInDate", ""),
            task.get("updatedAt", ""),
            dump_json(task),
        ),
    )


def delete_placement_task(conn, task_id):
    conn.execute("DELETE FROM placement_tasks WHERE id = ?", (task_id,))
