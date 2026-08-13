import json

SETTLEMENT_CANDIDATE_LIST_COLUMNS = {
    "month": {"expr": "billing_candidate_snapshots.month", "order": "billing_candidate_snapshots.month"},
    "pi": {"expr": "billing_candidate_snapshots.pi", "order": "billing_candidate_snapshots.pi"},
    "iacuc": {"expr": "billing_candidate_snapshots.iacucs_text", "order": "billing_candidate_snapshots.iacucs_text"},
    "amount": {
        "expr": (
            "CASE WHEN billing_candidate_snapshots.total_amount IS NULL THEN '' "
            "ELSE printf('%.2f', billing_candidate_snapshots.total_amount) END"
        ),
        "order": "billing_candidate_snapshots.total_amount",
    },
}


def _workflow_source_type(source_type):
    # 按项目负责人结算流程在 billing_workflows 中的 source_type 前缀。
    return f"pi_merged_{source_type}"


def workflow_exists_sql(source_type):
    """候选是否已发起按 PI 结算（billing_workflows 存在对应流程）。"""
    return (
        f"EXISTS (SELECT 1 FROM billing_workflows w WHERE w.source_type = '{_workflow_source_type(source_type)}' "
        "AND w.month = billing_candidate_snapshots.month "
        "AND w.iacuc = 'pi::' || billing_candidate_snapshots.pi)"
    )


def _workflow_scalar_sql(source_type, column):
    return (
        f"(SELECT w.{column} FROM billing_workflows w "
        f"WHERE w.source_type = '{_workflow_source_type(source_type)}' "
        "AND w.month = billing_candidate_snapshots.month "
        "AND w.iacuc = 'pi::' || billing_candidate_snapshots.pi LIMIT 1)"
    )


def workflow_id_sql(source_type):
    return _workflow_scalar_sql(source_type, "id")


def workflow_status_sql(source_type):
    return _workflow_scalar_sql(source_type, "workflow_status")


def workflow_column_expr(source_type):
    """结算状态列的聚合表达式，用于列表筛选与筛选选项。"""
    return (
        "CASE "
        f"WHEN NOT {workflow_exists_sql(source_type)} THEN '未发起' "
        f"WHEN {workflow_status_sql(source_type)} = 'statement_generated' THEN '已生成' "
        f"WHEN {workflow_status_sql(source_type)} = 'statement_sent' THEN '已发起' "
        f"WHEN {workflow_status_sql(source_type)} = 'statement_archived' THEN '已归档' "
        "ELSE '已发起' END"
    )


# Bump when quantity-sheet settlement rules change so persisted list snapshots are recalculated after deployment.
QUANTITY_SETTLEMENT_CALCULATION_VERSION = "2026-08-06-preferred-free-cage-fix"


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
                current["sourceFingerprint"] = "|".join([*fingerprint_parts, QUANTITY_SETTLEMENT_CALCULATION_VERSION])
            current = {"month": month, "pi": pi, "iacucs": []}
            groups.append(current)
            fingerprint_parts = []
        if iacuc:
            current["iacucs"].append(iacuc)
        fingerprint_parts.append(f"{row['id'] or ''}:{row['updated_at'] or ''}")
    if current:
        current["sourceFingerprint"] = "|".join([*fingerprint_parts, QUANTITY_SETTLEMENT_CALCULATION_VERSION])
    return groups


def get_quantity_settlement_group(conn, month, pi):
    rows = conn.execute(
        """
        SELECT iacuc, id, updated_at
        FROM quantity_sheets
        WHERE month = ? AND pi = ?
        ORDER BY iacuc COLLATE NOCASE, id COLLATE NOCASE
        """,
        (month, pi),
    ).fetchall()
    if not rows:
        return None
    return quantity_settlement_group_from_rows(month, pi, rows)


def quantity_settlement_group_from_rows(month, pi, rows):
    fingerprint_parts = [f"{row['id'] or ''}:{row['updated_at'] or ''}" for row in rows]
    return {
        "month": month,
        "pi": pi,
        "iacucs": [row["iacuc"] or "" for row in rows if row["iacuc"]],
        "sourceFingerprint": "|".join([*fingerprint_parts, QUANTITY_SETTLEMENT_CALCULATION_VERSION]),
    }


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
        SELECT
            month,
            pi,
            iacucs_json,
            total_amount,
            error_message,
            is_stale,
            updated_at,
            source_fingerprint,
            {workflow_exists_sql(source_type)} AS has_workflow,
            {workflow_id_sql(source_type)} AS workflow_id,
            {workflow_status_sql(source_type)} AS workflow_status
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
            source_fingerprint,
            {workflow_exists_sql(source_type)} AS has_workflow,
            {workflow_id_sql(source_type)} AS workflow_id,
            {workflow_status_sql(source_type)} AS workflow_status
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
        "manager": list_billing_candidate_manager_filter_options(conn, source_type, filters),
        "amount": list_billing_candidate_scalar_filter_options(conn, source_type, filters, "amount"),
        "workflow": list_billing_candidate_scalar_filter_options(conn, source_type, filters, "workflow"),
    }
    return items


def list_billing_candidate_manager_filter_options(conn, source_type, filters):
    where, params = billing_candidate_snapshot_where(
        source_type=source_type,
        filters=filters,
        exclude_column="manager",
    )
    rows = conn.execute(
        f"""
        SELECT qs.manager AS value, COUNT(DISTINCT billing_candidate_snapshots.rowid) AS count
        FROM billing_candidate_snapshots
        JOIN quantity_sheets qs
          ON qs.month = billing_candidate_snapshots.month
         AND qs.pi = billing_candidate_snapshots.pi
        WHERE {where}
          AND TRIM(COALESCE(qs.manager, '')) != ''
        GROUP BY qs.manager
        ORDER BY qs.manager COLLATE NOCASE
        LIMIT 500
        """,
        params,
    ).fetchall()
    return [
        {
            "value": row["value"],
            "label": row["value"],
            "count": row["count"],
        }
        for row in rows
    ]


def list_billing_candidate_scalar_filter_options(conn, source_type, filters, column):
    if column == "workflow":
        where, params = billing_candidate_snapshot_where(
            source_type=source_type, filters=filters, exclude_column=column
        )
        rows = conn.execute(
            f"""
            SELECT {workflow_column_expr(source_type)} AS value, COUNT(*) AS count
            FROM billing_candidate_snapshots
            WHERE {where}
            GROUP BY value
            ORDER BY value COLLATE NOCASE
            LIMIT 500
            """,
            params,
        ).fetchall()
        return [
            {"value": row["value"], "label": row["value"], "count": row["count"]}
            for row in rows
            if row["value"] not in (None, "")
        ]
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
        f"""
        SELECT
            month,
            pi,
            iacucs_json,
            total_amount,
            error_message,
            is_stale,
            updated_at,
            source_fingerprint,
            {workflow_exists_sql(source_type)} AS has_workflow,
            {workflow_id_sql(source_type)} AS workflow_id,
            {workflow_status_sql(source_type)} AS workflow_status
        FROM billing_candidate_snapshots
        WHERE month = ? AND pi = ? AND source_type = ?
        """,
        (month, pi, source_type),
    ).fetchone()
    return billing_candidate_snapshot_row(row) if row else None


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


def delete_billing_candidate_snapshot(conn, month, pi, source_type):
    conn.execute(
        "DELETE FROM billing_candidate_snapshots WHERE month = ? AND pi = ? AND source_type = ?",
        (month, pi, source_type),
    )


def billing_candidate_snapshot_registry_needs_sync(conn, source_type, fingerprint_fragment=""):
    row = conn.execute(
        "SELECT source_fingerprint FROM billing_candidate_snapshots WHERE source_type = ? LIMIT 1",
        (source_type,),
    ).fetchone()
    if row is None:
        return True
    if not fingerprint_fragment:
        return False
    return (
        conn.execute(
            """
            SELECT 1
            FROM billing_candidate_snapshots
            WHERE source_type = ? AND source_fingerprint NOT LIKE ?
            LIMIT 1
            """,
            (source_type, f"%{fingerprint_fragment}%"),
        ).fetchone()
        is not None
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
    where_parts = ["billing_candidate_snapshots.source_type = ?"]
    params = [source_type]
    # 按项目负责人结算只展示已生成-已发起阶段；已归档流程在核销工作台处理。
    where_parts.append(
        "NOT EXISTS (SELECT 1 FROM billing_workflows w "
        "WHERE w.source_type = 'pi_merged_quantity_sheet' "
        "AND w.month = billing_candidate_snapshots.month "
        "AND w.iacuc = 'pi::' || billing_candidate_snapshots.pi "
        "AND w.workflow_status = 'statement_archived')"
    )
    for column, values in (working_filters.get("columnFilters") or {}).items():
        cleaned = [str(value).strip() for value in values if str(value).strip()]
        if column == exclude_column or not cleaned:
            continue
        if column == "manager":
            placeholders = ", ".join("?" for _ in cleaned)
            where_parts.append(
                f"EXISTS (SELECT 1 FROM quantity_sheets qs "
                f"WHERE qs.month = billing_candidate_snapshots.month "
                f"AND qs.pi = billing_candidate_snapshots.pi "
                f"AND TRIM(COALESCE(qs.manager, '')) IN ({placeholders}))"
            )
            params.extend(cleaned)
            continue
        if column == "iacuc":
            placeholders = ", ".join("?" for _ in cleaned)
            where_parts.append(
                f"EXISTS (SELECT 1 FROM json_each(billing_candidate_snapshots.iacucs_json) WHERE json_each.value IN ({placeholders}))"
            )
            params.extend(cleaned)
            continue
        if column == "workflow":
            placeholders = ", ".join("?" for _ in cleaned)
            where_parts.append(f"COALESCE({workflow_column_expr(source_type)}, '') IN ({placeholders})")
            params.extend(cleaned)
            continue
        spec = SETTLEMENT_CANDIDATE_LIST_COLUMNS.get(column)
        if not spec:
            continue
        placeholders = ", ".join("?" for _ in cleaned)
        where_parts.append(f"COALESCE({spec['expr']}, '') IN ({placeholders})")
        params.extend(cleaned)
    if stale_only:
        where_parts.append("billing_candidate_snapshots.is_stale = 1")
    return " AND ".join(where_parts), tuple(params)


def billing_candidate_snapshot_order_by(filters):
    sort_key = str(filters.get("sortKey", "") or "").strip()
    sort_dir = "ASC" if str(filters.get("sortDir", "") or "").lower() == "asc" else "DESC"
    if sort_key == "manager":
        return (
            "(SELECT GROUP_CONCAT(manager, '、') FROM ("
            "SELECT DISTINCT manager FROM quantity_sheets qs "
            "WHERE qs.month = billing_candidate_snapshots.month "
            "AND qs.pi = billing_candidate_snapshots.pi "
            "AND TRIM(COALESCE(qs.manager, '')) != '' ORDER BY manager"
            f")) COLLATE NOCASE {sort_dir}, month {sort_dir}, pi COLLATE NOCASE, rowid DESC"
        )
    if sort_key == "pi":
        return f"pi COLLATE NOCASE {sort_dir}, month DESC, rowid DESC"
    if sort_key == "iacuc":
        return f"iacucs_text {sort_dir}, month DESC, pi COLLATE NOCASE, rowid DESC"
    if sort_key == "amount":
        return f"total_amount IS NULL ASC, total_amount {sort_dir}, month DESC, pi COLLATE NOCASE, rowid DESC"
    if sort_key == "workflow":
        return f"has_workflow {sort_dir}, month DESC, pi COLLATE NOCASE, rowid DESC"
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
        "hasWorkflow": bool(row["has_workflow"]),
        "workflowId": row["workflow_id"] or "",
        "workflowStatus": row["workflow_status"] or "",
        "updatedAt": row["updated_at"] or "",
        "sourceFingerprint": row["source_fingerprint"] or "",
    }
