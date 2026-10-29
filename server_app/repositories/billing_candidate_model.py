"""Candidate SQL expressions, filters, ordering and row projection."""

import json

from .person_names import column_predicate, prepare_person_filters

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
        f"WHEN {workflow_status_sql(source_type)} = 'statement_archived' THEN '已登记' "
        "ELSE '已发起' END"
    )


def billing_candidate_snapshot_where(*, source_type, filters=None, exclude_column="", stale_only=False, conn=None):
    working_filters = filters or {}
    if conn is not None:
        working_filters = prepare_person_filters(
            conn, working_filters, "billing_candidate_snapshots", {"pi": "pi"}, exclude=exclude_column
        )
    where_parts = ["billing_candidate_snapshots.source_type = ?"]
    params = [source_type]
    # 按项目负责人结算只展示已生成-已发起阶段；已登记/已归档流程在单据跟踪处理。
    where_parts.append(
        "NOT EXISTS (SELECT 1 FROM billing_workflows w "
        "WHERE w.source_type = 'pi_merged_quantity_sheet' "
        "AND w.month = billing_candidate_snapshots.month "
        "AND w.iacuc = 'pi::' || billing_candidate_snapshots.pi "
        "AND w.workflow_status IN ('statement_archived', 'statement_locked'))"
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
                "(billing_candidate_snapshots.source_type, billing_candidate_snapshots.month, "
                "billing_candidate_snapshots.pi) IN "
                "(SELECT candidate_iacucs.source_type, candidate_iacucs.month, candidate_iacucs.pi "
                "FROM billing_candidate_snapshot_iacucs candidate_iacucs "
                f"WHERE candidate_iacucs.source_type = ? AND candidate_iacucs.iacuc IN ({placeholders}))"
            )
            params.extend([source_type, *cleaned])
            continue
        if column == "workflow":
            placeholders = ", ".join("?" for _ in cleaned)
            where_parts.append(f"COALESCE({workflow_column_expr(source_type)}, '') IN ({placeholders})")
            params.extend(cleaned)
            continue
        spec = SETTLEMENT_CANDIDATE_LIST_COLUMNS.get(column)
        if not spec:
            continue
        clause, values = column_predicate(working_filters, column, f"COALESCE({spec['expr']}, '')", cleaned)
        where_parts.append(clause)
        params.extend(values)
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
