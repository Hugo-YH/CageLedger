import json

from .payload import paginated_payloads


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
    rows = conn.execute("SELECT pi, principal_type FROM principal_identities WHERE TRIM(COALESCE(pi, '')) != ''").fetchall()
    return {row["pi"]: row["principal_type"] for row in rows}


def list_audit_events_page(conn, filters, filtered_where):
    where, params = filtered_where(
        [
            ("entityType", "entity_type = ?"),
            ("action", "action = ?"),
        ],
        filters,
    )
    return paginated_payloads(conn, "audit_events", "at DESC, rowid DESC", where, params, filters["limit"], filters["offset"])


def list_intake_batches_page(conn, filters, filtered_where, entity_order_by):
    where, params = filtered_where(
        [
            ("status", "status = ?"),
            ("iacuc", "iacuc = ?"),
            ("roomName", "room_name = ?"),
        ],
        filters,
    )
    if filters.get("month"):
        where = " AND ".join([part for part in (where, "intake_date LIKE ?") if part])
        params = (*params, f"{filters['month']}%")
    return paginated_payloads(conn, "intake_batches", entity_order_by.get("intake_batches", "rowid"), where, params, filters["limit"], filters["offset"])


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
    where = " AND ".join(where_parts)
    if filters.get("month"):
        where = " AND ".join([part for part in (where, "planned_move_in_date LIKE ?") if part])
        params = (*params, f"{filters['month']}%")
    return paginated_payloads(conn, "placement_tasks", entity_order_by.get("placement_tasks", "rowid"), where, params, filters["limit"], filters["offset"])


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
