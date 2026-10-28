"""Candidate page, dashboard and filter-option retrieval."""

from .billing_candidate_model import (
    SETTLEMENT_CANDIDATE_LIST_COLUMNS,
    billing_candidate_snapshot_order_by,
    billing_candidate_snapshot_row,
    billing_candidate_snapshot_where,
    workflow_column_expr,
    workflow_exists_sql,
    workflow_id_sql,
    workflow_status_sql,
)


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


def list_dashboard_billing_candidate_snapshots(conn, source_type, month):
    """Return every source snapshot used by the dashboard, including closed workflows."""
    params = [source_type]
    where = "source_type = ?"
    if month != "all":
        where += " AND month = ?"
        params.append(month)
    return conn.execute(
        f"""
        SELECT month, pi, iacucs_json, total_amount, error_message, is_stale
        FROM billing_candidate_snapshots
        WHERE {where}
        ORDER BY month DESC, pi COLLATE NOCASE
        """,
        params,
    ).fetchall()


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
    limit = "" if column == "month" else "LIMIT 500"
    rows = conn.execute(
        f"""
        SELECT {spec["expr"]} AS value, COUNT(*) AS count
        FROM billing_candidate_snapshots
        WHERE {where}
        GROUP BY value
        ORDER BY value COLLATE NOCASE
        {limit}
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
        SELECT candidate_iacucs.iacuc AS value, COUNT(*) AS count
        FROM billing_candidate_snapshots
        JOIN billing_candidate_snapshot_iacucs AS candidate_iacucs
          ON candidate_iacucs.source_type = billing_candidate_snapshots.source_type
         AND candidate_iacucs.month = billing_candidate_snapshots.month
         AND candidate_iacucs.pi = billing_candidate_snapshots.pi
        WHERE {where}
        GROUP BY candidate_iacucs.iacuc
        ORDER BY candidate_iacucs.iacuc COLLATE NOCASE
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
