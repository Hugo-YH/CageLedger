"""Workflow, version and event retrieval, pagination and filter queries."""

import json

from server_app.cache import cache_generation, cache_get, cache_key, cache_set
from server_app.repositories.workflow_sources import append_workflow_source_filter

from .billing_workflow_projections import (
    billing_workflow_detail_row,
    billing_workflow_event_row,
    billing_workflow_list_row,
    billing_workflow_version_row,
)
from .person_names import column_predicate, individual_mode, person_options, prepare_person_filters


def get_billing_workflow_by_key(conn, business_key):
    row = conn.execute("SELECT payload FROM billing_workflows WHERE business_key = ?", (business_key,)).fetchone()
    return json.loads(row["payload"]) if row else None


def get_billing_workflow(conn, workflow_id):
    row = conn.execute("SELECT payload FROM billing_workflows WHERE id = ?", (workflow_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def get_billing_workflow_detail(conn, workflow_id):
    _cache_generation = cache_generation()
    key = cache_key("billing_workflows::detail", workflow_id=workflow_id)
    cached = cache_get(key, connection=conn)
    if cached is not None:
        return cached
    row = conn.execute(
        """
        SELECT
            workflows.id,
            workflows.business_key,
            workflows.iacuc,
            workflows.month,
            workflows.source_type,
            workflows.workflow_status,
            workflows.current_version_id,
            workflows.current_version_no,
            workflows.latest_event_at,
            json_extract(workflows.payload, '$.scopeType') AS scope_type,
            json_extract(workflows.payload, '$.scopeKey') AS scope_key,
            json_extract(workflows.payload, '$.iacucs') AS iacucs_json,
            json_extract(workflows.payload, '$.pi') AS pi,
            json_extract(workflows.payload, '$.project') AS project,
            json_extract(workflows.payload, '$.owner') AS owner,
            json_extract(workflows.payload, '$.funding') AS funding,
            json_extract(workflows.payload, '$.manager') AS manager,
            json_extract(workflows.payload, '$.totalAmount') AS total_amount,
            json_extract(workflows.payload, '$.totalCageDays') AS total_cage_days,
            json_extract(workflows.payload, '$.generatedAt') AS generated_at,
            json_extract(workflows.payload, '$.sentAt') AS sent_at,
            json_extract(workflows.payload, '$.sentBy') AS sent_by,
            json_extract(workflows.payload, '$.sheetUpdatedAt') AS sheet_updated_at,
            json_extract(workflows.payload, '$.signedReturnedAt') AS signed_returned_at,
            json_extract(workflows.payload, '$.submittedToFinanceAt') AS submitted_to_finance_at,
            json_extract(workflows.payload, '$.registeredAt') AS registered_at,
            json_extract(workflows.payload, '$.archivedAt') AS archived_at,
            json_extract(workflows.payload, '$.lockedFromStatus') AS locked_from_status,
            json_extract(workflows.payload, '$.receivedAmount') AS received_amount,
            json_extract(workflows.payload, '$.reimbursementFormNos') AS reimbursement_form_nos_json,
            json_extract(workflows.payload, '$.reimbursementForms') AS reimbursement_forms_json,
            json_extract(workflows.payload, '$.signedStatementReturned') AS signed_statement_returned,
            json_extract(workflows.payload, '$.signedStatementNote') AS signed_statement_note,
            json_extract(workflows.payload, '$.reimbursementFormReturned') AS reimbursement_form_returned,
            json_extract(workflows.payload, '$.reimbursementFormNote') AS reimbursement_form_note,
            json_extract(workflows.payload, '$.registeredBy') AS registered_by_json,
            json_extract(workflows.payload, '$.attachments') AS attachments_json,
            versions.id AS cv_id,
            versions.workflow_id AS cv_workflow_id,
            versions.version_no AS cv_version_no,
            versions.version_status AS cv_version_status,
            versions.workflow_status AS cv_workflow_status,
            versions.generated_at AS cv_generated_at,
            versions.voided_at AS cv_voided_at,
            json_extract(versions.payload, '$.voidedBy') AS cv_voided_by,
            json_extract(versions.payload, '$.voidReason') AS cv_void_reason,
            json_extract(versions.payload, '$.documentNumber') AS cv_document_number,
            json_extract(versions.payload, '$.summary') AS cv_summary_json
        FROM billing_workflows AS workflows
        LEFT JOIN billing_statement_versions AS versions
          ON versions.id = workflows.current_version_id
        WHERE workflows.id = ?
        """,
        (workflow_id,),
    ).fetchone()
    return cache_set(
        key,
        billing_workflow_detail_row(row) if row else None,
        expected_generation=_cache_generation if conn.in_transaction is not True else -1,
    )


def get_billing_version(conn, version_id):
    row = conn.execute("SELECT payload FROM billing_statement_versions WHERE id = ?", (version_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def list_billing_workflows(conn):
    rows = conn.execute("SELECT payload FROM billing_workflows ORDER BY month DESC, rowid DESC").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_billing_workflows_by_month(conn, month):
    rows = conn.execute(
        """
        SELECT payload
        FROM billing_workflows
        WHERE month = ?
          AND json_extract(payload, '$.pi') IS NOT NULL
          AND (json_extract(payload, '$.revertedAt') IS NULL OR json_extract(payload, '$.revertedAt') = '')
        ORDER BY rowid DESC
        """,
        (month,),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_billing_workflows_page(conn, filters, clean_text, workflow_status_finance):
    _cache_generation = cache_generation()
    filters = prepare_person_filters(conn, filters, "billing_workflows", {"pi": "json_extract(payload, '$.pi')"})
    clauses = []
    params = []
    column_filters = filters.get("columnFilters") or {}
    month_values = column_filters.get("month") or []
    if month_values:
        placeholders = ", ".join("?" for _ in month_values)
        clauses.append(f"month IN ({placeholders})")
        params.extend(month_values)
    else:
        month = clean_text(filters.get("month", ""))
        if month:
            clauses.append("month = ?")
            params.append(month)
    status_values = column_filters.get("status") or []
    if status_values:
        placeholders = ", ".join("?" for _ in status_values)
        clauses.append(f"workflow_status IN ({placeholders})")
        params.extend(status_values)
    else:
        status = clean_text(filters.get("status", ""))
        if status == "todo":
            clauses.append("workflow_status <> ?")
            params.append(workflow_status_finance)
        elif status == "done":
            clauses.append("workflow_status = ?")
            params.append(workflow_status_finance)
        elif status and status != "all":
            clauses.append("workflow_status = ?")
            params.append(status)
        else:
            # 核销工作台只展示已发起之后的阶段，已生成在按项目负责人结算处理。
            clauses.append("workflow_status <> 'statement_generated'")
    append_workflow_source_filter(clauses, params, clean_text(filters.get("sourceType", "")))
    if clean_text(filters.get("iacuc", "")):
        clauses.append("iacuc = ?")
        params.append(filters["iacuc"])
    pi_values = column_filters.get("pi") or []
    if pi_values:
        clause, values = column_predicate(filters, "pi", "json_extract(payload, '$.pi')", pi_values)
        clauses.append(clause)
        params.extend(values)
    else:
        pi = clean_text(filters.get("pi", ""))
        if pi:
            clauses.append("json_extract(payload, '$.pi') = ?")
            params.append(pi)
    manager_values = column_filters.get("manager") or []
    if manager_values:
        placeholders = ", ".join("?" for _ in manager_values)
        clauses.append(f"json_extract(payload, '$.manager') IN ({placeholders})")
        params.extend(manager_values)
    iacuc_filters = column_filters.get("iacuc") or []
    if iacuc_filters:
        placeholders = ", ".join("?" for _ in iacuc_filters)
        clauses.append(
            f"EXISTS (SELECT 1 FROM json_each(json_extract(payload, '$.iacucs')) WHERE json_each.value IN ({placeholders}))"
        )
        params.extend(iacuc_filters)
    where = " AND ".join(clauses)
    order_by = _billing_workflow_order_by(filters)
    key = cache_key(
        "billing_workflows",
        limit=filters["limit"],
        offset=filters["offset"],
        status=tuple(status_values),
        month=tuple(month_values),
        source_type=clean_text(filters.get("sourceType", "")),
        iacuc=clean_text(filters.get("iacuc", "")),
        pi=tuple(pi_values),
        person_filter_mode=filters.get("personFilterMode", ""),
        manager=tuple(manager_values),
        iacuc_filters=tuple(iacuc_filters),
        sort_key=filters.get("sortKey", ""),
        sort_dir=filters.get("sortDir", ""),
    )
    cached = cache_get(key, connection=conn)
    if cached is not None:
        return cached
    where_clause = f" WHERE {where}" if where else ""
    total = conn.execute(f"SELECT COUNT(*) AS total FROM billing_workflows{where_clause}", tuple(params)).fetchone()[
        "total"
    ]
    rows = conn.execute(
        f"""
        SELECT
            id,
            business_key,
            iacuc,
            month,
            source_type,
            workflow_status,
            current_version_id,
            current_version_no,
            latest_event_at,
            json_extract(payload, '$.scopeType') AS scope_type,
            json_extract(payload, '$.scopeKey') AS scope_key,
            json_extract(payload, '$.iacucs') AS iacucs_json,
            json_extract(payload, '$.pi') AS pi,
            json_extract(payload, '$.project') AS project,
            json_extract(payload, '$.owner') AS owner,
            json_extract(payload, '$.funding') AS funding,
            json_extract(payload, '$.manager') AS manager,
            json_extract(payload, '$.totalAmount') AS total_amount,
            json_extract(payload, '$.totalCageDays') AS total_cage_days,
            json_extract(payload, '$.generatedAt') AS generated_at,
            json_extract(payload, '$.sentAt') AS sent_at,
            json_extract(payload, '$.sentBy') AS sent_by,
            json_extract(payload, '$.sheetUpdatedAt') AS sheet_updated_at,
            json_extract(payload, '$.signedReturnedAt') AS signed_returned_at,
            json_extract(payload, '$.submittedToFinanceAt') AS submitted_to_finance_at,
            json_extract(payload, '$.registeredAt') AS registered_at,
            json_extract(payload, '$.archivedAt') AS archived_at,
            json_extract(payload, '$.lockedFromStatus') AS locked_from_status,
            json_extract(payload, '$.receivedAmount') AS received_amount,
            json_extract(payload, '$.reimbursementFormNos') AS reimbursement_form_nos_json,
            json_extract(payload, '$.reimbursementForms') AS reimbursement_forms_json,
            json_extract(payload, '$.signedStatementReturned') AS signed_statement_returned,
            json_extract(payload, '$.signedStatementNote') AS signed_statement_note,
            json_extract(payload, '$.reimbursementFormReturned') AS reimbursement_form_returned,
            json_extract(payload, '$.reimbursementFormNote') AS reimbursement_form_note,
            json_extract(payload, '$.registeredBy') AS registered_by_json,
            json_extract(payload, '$.attachments') AS attachments_json
        FROM billing_workflows{where_clause}
        ORDER BY {order_by}
        LIMIT ? OFFSET ?
        """,
        (*params, filters["limit"], filters["offset"]),
    ).fetchall()
    payload = {
        "items": [billing_workflow_list_row(row) for row in rows],
        "page": {
            "limit": filters["limit"],
            "offset": filters["offset"],
            "total": total,
            "hasMore": filters["offset"] + filters["limit"] < total,
        },
    }
    return cache_set(key, payload, expected_generation=_cache_generation if conn.in_transaction is not True else -1)


def _billing_workflow_order_by(filters):
    sort_key = str(filters.get("sortKey", "") or "").strip()
    sort_dir = "ASC" if str(filters.get("sortDir", "") or "").lower() == "asc" else "DESC"
    expressions = {
        "month": "month",
        "pi": "json_extract(payload, '$.pi') COLLATE NOCASE",
        "manager": "json_extract(payload, '$.manager') COLLATE NOCASE",
        "iacuc": "iacuc COLLATE NOCASE",
        "totalAmount": "json_extract(payload, '$.totalAmount')",
        "latestEventAt": "latest_event_at",
        "workflowStatus": "workflow_status COLLATE NOCASE",
    }
    expression = expressions.get(sort_key)
    if expression:
        return f"{expression} {sort_dir}, month DESC, rowid DESC"
    return "month DESC, rowid DESC"


def list_billing_workflow_filter_options(conn, filters, column):
    filters = prepare_person_filters(
        conn, filters, "billing_workflows", {"pi": "json_extract(payload, '$.pi')"}, exclude=column
    )
    where, params = _billing_workflow_filter_where(filters, exclude_column=column)
    where_clause = f" WHERE {where}" if where else ""
    if column == "status":
        rows = conn.execute(
            f"""
            SELECT workflow_status AS value,
                   CASE workflow_status
                       WHEN 'statement_generated' THEN '已生成'
                       WHEN 'statement_sent' THEN '已发起'
                       WHEN 'statement_archived' THEN '未归档（已登记）'
                       WHEN 'statement_locked' THEN '已归档'
                       ELSE workflow_status
                   END AS label,
                   COUNT(*) AS count
            FROM billing_workflows
            {where_clause + " AND " if where_clause else "WHERE "}workflow_status <> 'statement_generated'
            GROUP BY value, label
            ORDER BY value COLLATE NOCASE
            """,
            tuple(params),
        ).fetchall()
    elif column == "iacuc":
        rows = conn.execute(
            f"""
            SELECT value, value AS label, COUNT(*) AS count
            FROM billing_workflows, json_each(json_extract(billing_workflows.payload, '$.iacucs'))
            {where_clause}
            GROUP BY value
            ORDER BY value COLLATE NOCASE
            LIMIT 500
            """,
            tuple(params),
        ).fetchall()
    else:
        expressions = {
            "month": "month",
            "pi": "json_extract(payload, '$.pi')",
            "manager": "json_extract(payload, '$.manager')",
        }
        expression = expressions.get(column)
        if not expression:
            return []
        limit = "" if column == "month" or individual_mode(filters, column) else "LIMIT 500"
        rows = conn.execute(
            f"""
            SELECT {expression} AS value, {expression} AS label, COUNT(*) AS count
            FROM billing_workflows
            {where_clause + " AND " if where_clause else "WHERE "}{expression} IS NOT NULL AND {expression} != ''
            GROUP BY value, label
            ORDER BY value COLLATE NOCASE
            {limit}
            """,
            tuple(params),
        ).fetchall()
    items = [
        {"value": row["value"] or "", "label": row["label"] or row["value"] or "", "count": row["count"]}
        for row in rows
        if row["value"]
    ]

    return person_options(filters, column, items)


def _billing_workflow_filter_where(filters, exclude_column=""):
    clauses = []
    params = []
    scalar_columns = {
        "month": "month",
        "pi": "json_extract(payload, '$.pi')",
        "manager": "json_extract(payload, '$.manager')",
        "status": "workflow_status",
    }
    for column, expression in scalar_columns.items():
        if column == exclude_column:
            continue
        values = (filters.get("columnFilters") or {}).get(column) or []
        if not values:
            continue
        clause, selected = column_predicate(filters, column, expression, values)
        clauses.append(clause)
        params.extend(selected)
    iacuc_values = [] if exclude_column == "iacuc" else (filters.get("columnFilters") or {}).get("iacuc") or []
    if iacuc_values:
        placeholders = ", ".join("?" for _ in iacuc_values)
        clauses.append(
            f"EXISTS (SELECT 1 FROM json_each(json_extract(payload, '$.iacucs')) WHERE json_each.value IN ({placeholders}))"
        )
        params.extend(iacuc_values)
    return " AND ".join(clauses), params


def list_billing_workflow_versions(conn, workflow_id):
    _cache_generation = cache_generation()
    key = cache_key("billing_workflows::versions", workflow_id=workflow_id)
    cached = cache_get(key, connection=conn)
    if cached is not None:
        return cached
    rows = conn.execute(
        """
        SELECT
            id,
            workflow_id,
            version_no,
            version_status,
            workflow_status,
            generated_at,
            voided_at,
            json_extract(payload, '$.voidedBy') AS voided_by,
            json_extract(payload, '$.voidReason') AS void_reason,
            json_extract(payload, '$.documentNumber') AS document_number,
            json_extract(payload, '$.summary') AS summary_json
        FROM billing_statement_versions
        WHERE workflow_id = ?
        ORDER BY version_no DESC, rowid DESC
        """,
        (workflow_id,),
    ).fetchall()
    return cache_set(
        key,
        [billing_workflow_version_row(row) for row in rows],
        expected_generation=_cache_generation if conn.in_transaction is not True else -1,
    )


def list_billing_workflow_events(conn, workflow_id):
    _cache_generation = cache_generation()
    key = cache_key("billing_workflows::events", workflow_id=workflow_id)
    cached = cache_get(key, connection=conn)
    if cached is not None:
        return cached
    rows = conn.execute(
        """
        SELECT
            id,
            workflow_id,
            version_id,
            event_type,
            from_status,
            to_status,
            at,
            json_extract(payload, '$.actor.id') AS actor_id,
            json_extract(payload, '$.actor.username') AS actor_username,
            json_extract(payload, '$.actor.displayName') AS actor_display_name,
            json_extract(payload, '$.note') AS note,
            json_extract(payload, '$.signedStatementNote') AS signed_statement_note,
            json_extract(payload, '$.reimbursementFormNote') AS reimbursement_form_note
        FROM billing_workflow_events
        WHERE workflow_id = ?
        ORDER BY at DESC, rowid DESC
        """,
        (workflow_id,),
    ).fetchall()
    return cache_set(
        key,
        [billing_workflow_event_row(row) for row in rows],
        expected_generation=_cache_generation if conn.in_transaction is not True else -1,
    )
