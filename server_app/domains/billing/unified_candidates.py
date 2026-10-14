"""One paginated candidate list, with separate feeding and service identities."""

import json

from server_app.domains.technical_services import listing as services_listing
from server_app.domains.technical_services import repository as services_repo
from server_app.domains.workflow.permissions import with_withdrawal_capabilities
from server_app.repositories.billing_candidates import (
    billing_candidate_snapshot_where,
    workflow_column_expr,
    workflow_exists_sql,
    workflow_id_sql,
    workflow_status_sql,
)
from server_app.shared import now_iso

from .candidates import list_settlement_candidates, refresh_settlement_candidate_snapshot

COLUMNS = {key: key for key in ("month", "pi", "iacuc", "manager", "amount", "workflow", "feeType")}
LABELS = {"feeding": "饲养费", "technical_service": "技术服务费"}


def prepare(conn, filters, calculate, *, column=""):
    services_listing.columns(filters, COLUMNS)
    # Keep the existing feeding registry and amount-refresh rules. Source sheets
    # remain protected by their own domains; this list never writes statements.
    feeding_filters = {
        **filters,
        "limit": 1,
        "offset": 0,
        "columnFilters": {k: v for k, v in filters.get("columnFilters", {}).items() if k != "feeType"},
    }
    if column == "amount":
        feeding_filters["sortKey"] = "amount"
    elif feeding_filters.get("sortKey") == "feeType":
        feeding_filters["sortKey"] = "month"
    list_settlement_candidates(conn, feeding_filters, calculate, "quantity_sheet", now_iso())


def base(conn, actor):
    feeding_where, _ = billing_candidate_snapshot_where(source_type="quantity_sheet")
    manager = """(SELECT GROUP_CONCAT(manager, '、') FROM
        (SELECT DISTINCT manager FROM quantity_sheets qs WHERE qs.month=b.month AND qs.pi=b.pi
         AND TRIM(COALESCE(manager,''))!='' ORDER BY manager))"""
    manager_json = """(SELECT json_group_array(manager) FROM
        (SELECT DISTINCT manager FROM quantity_sheets qs WHERE qs.month=b.month AND qs.pi=b.pi
         AND TRIM(COALESCE(manager,''))!='' ORDER BY manager))"""
    feeding = f"""SELECT 'feeding' AS feeType, 'quantity_sheet' AS sourceType, b.month, b.pi,
        b.iacucs_text AS iacuc, b.iacucs_json AS iacuc_json, COALESCE({manager},'') AS manager,
        {manager_json} AS manager_json, b.total_amount AS amount, b.error_message AS error,
        {workflow_column_expr("quantity_sheet")} AS workflow,
        {workflow_id_sql("quantity_sheet")} AS workflow_id,
        {workflow_status_sql("quantity_sheet")} AS workflow_status,
        {workflow_exists_sql("quantity_sheet")} AS has_workflow, b.is_stale AS stale
        FROM billing_candidate_snapshots AS b WHERE {feeding_where.replace("billing_candidate_snapshots.", "b.")}"""
    # Workflow subqueries use the existing correlated table name.
    feeding = feeding.replace("billing_candidate_snapshots.", "b.")
    params = ["quantity_sheet"]
    if actor.get("role") not in ("admin", "room_admin"):
        return feeding, params
    services_repo.protected_ids(conn)
    technical, technical_params = services_listing.candidate_base(services_repo.SOURCE_TYPE)
    service = f"""SELECT 'technical_service' AS feeType, '{services_repo.SOURCE_TYPE}' AS sourceType,
        month, pi, iacuc, iacuc_json, manager, manager_json, amount, '' AS error,
        CASE WHEN workflow_id IS NULL THEN '未发起' WHEN workflow_status='statement_generated' THEN '已生成'
             WHEN workflow_status='statement_archived' THEN '已登记' ELSE '已发起' END AS workflow,
        workflow_id, workflow_status, workflow_id IS NOT NULL AS has_workflow, 0 AS stale
        FROM ({technical}) WHERE COALESCE(workflow_status,'') NOT IN ('statement_archived','statement_locked')"""
    return feeding + " UNION ALL " + service, [*params, *technical_params]


def where(filters, *, exclude=""):
    clauses, params = [], []
    for column, values in services_listing.columns(filters, COLUMNS).items():
        if column == exclude or not values:
            continue
        marks = ",".join("?" for _ in values)
        if column in ("iacuc", "manager"):
            clauses.append(f"EXISTS (SELECT 1 FROM json_each({column}_json) WHERE value IN ({marks}))")
            params.extend(values)
        elif column == "amount":
            clauses.append(f"printf('%.2f',amount) IN ({marks}) AND amount IS NOT NULL")
            params.extend(values)
        else:
            clauses.append(f"{column} IN ({marks})")
            params.extend(values)
    return " AND ".join(clauses) or "1", params


def list_candidates(conn, actor, filters, calculate):
    prepare(conn, filters, calculate)
    source, source_params = base(conn, actor)
    condition, params = where(filters)
    params = [*source_params, *params]
    order = services_listing.order(filters, COLUMNS, "month DESC")
    order = ("amount IS NULL ASC, " if filters.get("sortKey") == "amount" else "") + order
    sql = f"SELECT * FROM ({source}) WHERE {condition} ORDER BY {order}, month DESC, pi COLLATE NOCASE, feeType"
    limit, offset = services_listing.pagination(filters)
    total = conn.execute(f"SELECT COUNT(*) FROM ({source}) WHERE {condition}", params).fetchone()[0]
    rows = conn.execute(sql + " LIMIT ? OFFSET ?", [*params, limit, offset]).fetchall()
    stale = [row for row in rows if row["feeType"] == "feeding" and row["stale"]]
    for row in stale:
        refresh_settlement_candidate_snapshot(conn, row["month"], row["pi"], calculate, now=now_iso())
    if stale:
        rows = conn.execute(sql + " LIMIT ? OFFSET ?", [*params, limit, offset]).fetchall()
    items = [
        {
            "id": f"{row['feeType']}::{row['month']}::{row['pi']}",
            "month": row["month"],
            "pi": row["pi"],
            "feeType": row["feeType"],
            "sourceType": row["sourceType"],
            "iacucs": sorted(json.loads(row["iacuc_json"] or "[]")),
            "manager": row["manager"] or "",
            "totalAmount": row["amount"],
            "error": row["error"],
            "hasWorkflow": bool(row["has_workflow"]),
            "workflowId": row["workflow_id"] or "",
            "workflowStatus": row["workflow_status"] or "",
        }
        for row in rows
    ]
    return {
        "items": with_withdrawal_capabilities(conn, actor, items, id_key="workflowId"),
        "page": services_listing.page(total, limit, offset),
        "filterOptions": {},
    }


def filter_options(conn, actor, filters, column, calculate):
    if column not in COLUMNS:
        raise ValueError("筛选字段无效")
    scoped = {**filters, "columnFilters": {k: v for k, v in filters.get("columnFilters", {}).items() if k != column}}
    prepare(conn, scoped, calculate, column=column)
    source, values = base(conn, actor)
    condition, params = where(filters, exclude=column)
    if column in ("iacuc", "manager"):
        sql = f"SELECT value, COUNT(*) FROM ({source}) q, json_each(q.{column}_json) WHERE {condition} GROUP BY value ORDER BY value"
    else:
        expression = "printf('%.2f',amount)" if column == "amount" else column
        sql = (
            f"SELECT {expression} AS value, COUNT(*) FROM ({source}) WHERE {condition}"
            + (" AND amount IS NOT NULL" if column == "amount" else "")
            + f" GROUP BY {expression} ORDER BY {expression}"
        )
    return {
        "items": [
            {"value": row[0], "label": LABELS.get(row[0], row[0]), "count": row[1]}
            for row in conn.execute(sql, [*values, *params])
            if row[0] not in (None, "")
        ]
    }
