import json

SETTLEMENT_CANDIDATE_LIST_COLUMNS = {
    "month": {"expr": "month", "order": "month"},
    "pi": {"expr": "pi", "order": "pi"},
    "iacuc": {"expr": "iacucs_text", "order": "iacucs_text"},
    "amount": {
        "expr": "CASE WHEN total_amount IS NULL THEN '' ELSE printf('%.2f', total_amount) END",
        "order": "total_amount",
    },
}


def list_quantity_settlement_groups(conn):
    rows = conn.execute(
        """
        SELECT month, pi, iacuc, id, updated_at
        FROM quantity_sheets
        WHERE TRIM(COALESCE(month, '')) != '' AND TRIM(COALESCE(pi, '')) != ''
        ORDER BY month DESC, pi COLLATE NOCASE, iacuc COLLATE NOCASE, id COLLATE NOCASE
        """
    ).fetchall()
    groups = []
    current = None
    fingerprint_parts = []
    for row in rows:
        month = row["month"] or ""
        pi = row["pi"] or ""
        iacuc = row["iacuc"] or ""
        if not current or current["month"] != month or current["pi"] != pi:
            if current:
                current["sourceFingerprint"] = "|".join(fingerprint_parts)
            current = {"month": month, "pi": pi, "iacucs": []}
            groups.append(current)
            fingerprint_parts = []
        if iacuc:
            current["iacucs"].append(iacuc)
        fingerprint_parts.append(f"{row['id'] or ''}:{row['updated_at'] or ''}")
    if current:
        current["sourceFingerprint"] = "|".join(fingerprint_parts)
    return groups


def sync_billing_candidate_snapshot_registry(conn, source_type, now):
    groups = list_quantity_settlement_groups(conn) if source_type == "quantity_sheet" else []
    current_by_key = {
        (item["month"], item["pi"]): item
        for item in list_billing_candidate_snapshot_keys(conn, source_type=source_type)
    }
    live_keys = set()
    for group in groups:
        month = group["month"]
        pi = group["pi"]
        live_keys.add((month, pi))
        snapshot = current_by_key.get((month, pi))
        if snapshot is None:
            upsert_billing_candidate_snapshot(
                conn,
                {
                    "month": month,
                    "pi": pi,
                    "sourceType": source_type,
                    "iacucs": group.get("iacucs", []),
                    "totalAmount": None,
                    "error": "",
                    "stale": True,
                    "updatedAt": now,
                    "sourceFingerprint": group.get("sourceFingerprint", ""),
                },
            )
            continue
        current_iacucs = list(snapshot.get("iacucs") or [])
        next_iacucs = list(group.get("iacucs") or [])
        next_fingerprint = group.get("sourceFingerprint", "")
        if current_iacucs != next_iacucs or snapshot.get("sourceFingerprint", "") != next_fingerprint:
            upsert_billing_candidate_snapshot(
                conn,
                {
                    "month": month,
                    "pi": pi,
                    "sourceType": source_type,
                    "iacucs": next_iacucs,
                    "totalAmount": None,
                    "error": "",
                    "stale": True,
                    "updatedAt": now,
                    "sourceFingerprint": next_fingerprint,
                },
            )
    delete_orphaned_billing_candidate_snapshots(conn, source_type, live_keys)


def list_billing_candidate_snapshot_keys(conn, *, source_type, filters=None, stale_only=False, exclude_amount=False):
    working_filters = dict(filters or {})
    if exclude_amount and working_filters.get("columnFilters"):
        working_filters["columnFilters"] = {
            key: value for key, value in (working_filters.get("columnFilters") or {}).items() if key != "amount"
        }
    where, params = billing_candidate_snapshot_where(
        source_type=source_type,
        filters=working_filters,
        stale_only=stale_only,
    )
    rows = conn.execute(
        f"""
        SELECT month, pi, iacucs_json, total_amount, error_message, is_stale, updated_at, source_fingerprint
        FROM billing_candidate_snapshots
        WHERE {where}
        ORDER BY month DESC, pi COLLATE NOCASE
        """,
        params,
    ).fetchall()
    return [billing_candidate_snapshot_row(row) for row in rows]


def list_billing_candidate_snapshots_page(conn, source_type, filters):
    where, params = billing_candidate_snapshot_where(source_type=source_type, filters=filters)
    order_by = billing_candidate_snapshot_order_by(filters)
    total = conn.execute(f"SELECT COUNT(*) AS total FROM billing_candidate_snapshots WHERE {where}", params).fetchone()[
        "total"
    ]
    rows = conn.execute(
        f"""
        SELECT
            month,
            pi,
            iacucs_json,
            total_amount,
            error_message,
            is_stale,
            updated_at,
            source_fingerprint
        FROM billing_candidate_snapshots
        WHERE {where}
        ORDER BY {order_by}
        LIMIT ? OFFSET ?
        """,
        (*params, filters["limit"], filters["offset"]),
    ).fetchall()
    return {
        "items": [billing_candidate_snapshot_row(row) for row in rows],
        "page": {
            "limit": filters["limit"],
            "offset": filters["offset"],
            "total": total,
            "hasMore": filters["offset"] + filters["limit"] < total,
        },
    }


def list_billing_candidate_filter_options(conn, source_type, filters):
    items = {
        "month": list_billing_candidate_scalar_filter_options(conn, source_type, filters, "month"),
        "pi": list_billing_candidate_scalar_filter_options(conn, source_type, filters, "pi"),
        "iacuc": list_billing_candidate_iacuc_filter_options(conn, source_type, filters),
        "amount": list_billing_candidate_scalar_filter_options(conn, source_type, filters, "amount"),
    }
    return items


def list_billing_candidate_scalar_filter_options(conn, source_type, filters, column):
    spec = SETTLEMENT_CANDIDATE_LIST_COLUMNS.get(column)
    if not spec:
        return []
    where, params = billing_candidate_snapshot_where(source_type=source_type, filters=filters, exclude_column=column)
    rows = conn.execute(
        f"""
        SELECT {spec["expr"]} AS value, COUNT(*) AS count
        FROM billing_candidate_snapshots
        WHERE {where}
        GROUP BY value
        ORDER BY value COLLATE NOCASE
        LIMIT 500
        """,
        params,
    ).fetchall()
    return [
        {
            "value": row["value"] or "",
            "label": f"¥{row['value']}" if column == "amount" else (row["value"] or "空白"),
            "count": row["count"],
        }
        for row in rows
        if row["value"] not in (None, "")
    ]


def list_billing_candidate_iacuc_filter_options(conn, source_type, filters):
    where, params = billing_candidate_snapshot_where(source_type=source_type, filters=filters, exclude_column="iacuc")
    rows = conn.execute(
        f"""
        SELECT json_each.value AS value, COUNT(*) AS count
        FROM billing_candidate_snapshots
        JOIN json_each(billing_candidate_snapshots.iacucs_json)
        WHERE {where}
        GROUP BY json_each.value
        ORDER BY json_each.value COLLATE NOCASE
        LIMIT 500
        """,
        params,
    ).fetchall()
    return [{"value": row["value"], "label": row["value"], "count": row["count"]} for row in rows if row["value"]]


def get_billing_candidate_snapshot(conn, month, pi, source_type):
    row = conn.execute(
        """
        SELECT month, pi, iacucs_json, total_amount, error_message, is_stale, updated_at, source_fingerprint
        FROM billing_candidate_snapshots
        WHERE month = ? AND pi = ? AND source_type = ?
        """,
        (month, pi, source_type),
    ).fetchone()
    return billing_candidate_snapshot_row(row) if row else None


def get_quantity_settlement_group(conn, month, pi):
    for group in list_quantity_settlement_groups(conn):
        if group["month"] == month and group["pi"] == pi:
            return group
    return None


def upsert_billing_candidate_snapshot(conn, snapshot):
    iacucs = sorted({str(item).strip() for item in snapshot.get("iacucs", []) if str(item).strip()})
    conn.execute(
        """
        INSERT INTO billing_candidate_snapshots (
            source_type,
            month,
            pi,
            iacucs_json,
            iacucs_text,
            total_amount,
            error_message,
            is_stale,
            updated_at,
            source_fingerprint
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_type, month, pi) DO UPDATE SET
            iacucs_json = excluded.iacucs_json,
            iacucs_text = excluded.iacucs_text,
            total_amount = excluded.total_amount,
            error_message = excluded.error_message,
            is_stale = excluded.is_stale,
            updated_at = excluded.updated_at,
            source_fingerprint = excluded.source_fingerprint
        """,
        (
            snapshot["sourceType"],
            snapshot["month"],
            snapshot["pi"],
            json.dumps(iacucs, ensure_ascii=False),
            "、".join(iacucs),
            snapshot.get("totalAmount"),
            snapshot.get("error", ""),
            1 if snapshot.get("stale") else 0,
            snapshot["updatedAt"],
            snapshot.get("sourceFingerprint", ""),
        ),
    )


def mark_billing_candidate_snapshots_stale(conn, source_type, keys, now):
    cleaned = sorted({(month, pi) for month, pi in keys if month and pi})
    if not cleaned:
        return
    placeholders = ", ".join("(?, ?)" for _ in cleaned)
    conn.execute(
        f"""
        UPDATE billing_candidate_snapshots
        SET total_amount = NULL,
            error_message = '',
            is_stale = 1,
            updated_at = ?
        WHERE source_type = ?
          AND (month, pi) IN ({placeholders})
        """,
        (now, source_type, *[value for pair in cleaned for value in pair]),
    )


def mark_billing_candidate_snapshots_stale_by_pi(conn, source_type, pi_name, now):
    if not pi_name:
        return
    conn.execute(
        """
        UPDATE billing_candidate_snapshots
        SET total_amount = NULL,
            error_message = '',
            is_stale = 1,
            updated_at = ?
        WHERE source_type = ? AND pi = ?
        """,
        (now, source_type, pi_name),
    )


def mark_all_billing_candidate_snapshots_stale(conn, source_type, now):
    conn.execute(
        """
        UPDATE billing_candidate_snapshots
        SET total_amount = NULL,
            error_message = '',
            is_stale = 1,
            updated_at = ?
        WHERE source_type = ?
        """,
        (now, source_type),
    )


def delete_orphaned_billing_candidate_snapshots(conn, source_type, live_keys):
    live_keys = sorted(live_keys)
    if not live_keys:
        conn.execute("DELETE FROM billing_candidate_snapshots WHERE source_type = ?", (source_type,))
        return
    placeholders = ", ".join("(?, ?)" for _ in live_keys)
    conn.execute(
        f"""
        DELETE FROM billing_candidate_snapshots
        WHERE source_type = ?
          AND (month, pi) NOT IN ({placeholders})
        """,
        (source_type, *[value for pair in live_keys for value in pair]),
    )


def billing_candidate_snapshot_where(*, source_type, filters=None, exclude_column="", stale_only=False):
    working_filters = filters or {}
    where_parts = ["source_type = ?"]
    params = [source_type]
    for column, values in (working_filters.get("columnFilters") or {}).items():
        cleaned = [str(value).strip() for value in values if str(value).strip()]
        if column == exclude_column or not cleaned:
            continue
        if column == "iacuc":
            placeholders = ", ".join("?" for _ in cleaned)
            where_parts.append(
                f"EXISTS (SELECT 1 FROM json_each(billing_candidate_snapshots.iacucs_json) WHERE json_each.value IN ({placeholders}))"
            )
            params.extend(cleaned)
            continue
        spec = SETTLEMENT_CANDIDATE_LIST_COLUMNS.get(column)
        if not spec:
            continue
        placeholders = ", ".join("?" for _ in cleaned)
        where_parts.append(f"COALESCE({spec['expr']}, '') IN ({placeholders})")
        params.extend(cleaned)
    if stale_only:
        where_parts.append("is_stale = 1")
    return " AND ".join(where_parts), tuple(params)


def billing_candidate_snapshot_order_by(filters):
    sort_key = str(filters.get("sortKey", "") or "").strip()
    sort_dir = "ASC" if str(filters.get("sortDir", "") or "").lower() == "asc" else "DESC"
    if sort_key == "pi":
        return f"pi COLLATE NOCASE {sort_dir}, month DESC, rowid DESC"
    if sort_key == "iacuc":
        return f"iacucs_text {sort_dir}, month DESC, pi COLLATE NOCASE, rowid DESC"
    if sort_key == "amount":
        return f"total_amount IS NULL ASC, total_amount {sort_dir}, month DESC, pi COLLATE NOCASE, rowid DESC"
    return f"month {sort_dir}, pi COLLATE NOCASE, rowid DESC"


def billing_candidate_snapshot_row(row):
    if row is None:
        return None
    iacucs = json.loads(row["iacucs_json"] or "[]")
    return {
        "id": f"{row['month'] or ''}::{row['pi'] or ''}",
        "month": row["month"] or "",
        "pi": row["pi"] or "",
        "iacucs": iacucs,
        "totalAmount": None if row["total_amount"] is None else float(row["total_amount"]),
        "error": row["error_message"] or "",
        "isStale": bool(row["is_stale"]),
        "updatedAt": row["updated_at"] or "",
        "sourceFingerprint": row["source_fingerprint"] or "",
    }
