import json

from server_app.cache import cache_get, cache_key, cache_set

from .payload import dump_json

QUANTITY_SHEET_LIST_COLUMNS = {
    "month": {"expr": "month", "order": "month"},
    "iacuc": {"expr": "iacuc", "order": "iacuc"},
    "roomName": {"expr": "room_name", "order": "room_name"},
    "pi": {"expr": "pi", "order": "pi"},
    "updatedAt": {"expr": "updated_at", "order": "updated_at"},
}


def list_quantity_sheets(conn):
    rows = conn.execute("SELECT payload FROM quantity_sheets ORDER BY month DESC, iacuc, updated_at DESC").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_quantity_sheets_page(conn, filters, filtered_where):
    where, params = quantity_sheet_where(filters, filtered_where)
    order_by = quantity_sheet_order_by(filters)
    key = cache_key(
        "quantity_sheets",
        limit=filters["limit"],
        offset=filters["offset"],
        sort_key=str(filters.get("sortKey", "")).strip(),
        sort_dir=str(filters.get("sortDir", "")).strip(),
        column_filters=filters.get("columnFilters", {}),
        month=str(filters.get("month", "")).strip(),
        iacuc=str(filters.get("iacuc", "")).strip(),
        pi=str(filters.get("pi", "")).strip(),
        room_id=str(filters.get("roomId", "")).strip(),
    )
    cached = cache_get(key)
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
    return cache_set(key, payload)


def quantity_sheet_where(filters, filtered_where, exclude_column=""):
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
        cleaned = [str(value).strip() for value in values if str(value).strip()]
        if not spec or not cleaned:
            continue
        placeholders = ", ".join("?" for _ in cleaned)
        where_parts.append(f"COALESCE({spec['expr']}, '') IN ({placeholders})")
        next_params.extend(cleaned)
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
    where, params = quantity_sheet_where(filters, filtered_where, exclude_column=column)
    where_clause = f" WHERE {where}" if where else ""
    rows = conn.execute(
        f"""
        SELECT COALESCE({spec['expr']}, '') AS value, COUNT(*) AS count
        FROM quantity_sheets{where_clause}
        GROUP BY value
        ORDER BY value COLLATE NOCASE
        LIMIT 500
        """,
        params,
    ).fetchall()
    return {
        "items": [
            {"value": row["value"] or "", "label": row["value"] or "空白", "count": row["count"]}
            for row in rows
        ],
    }


def quantity_sheet_list_row(row):
    return {
        "id": row["id"] or "",
        "month": row["month"] or "",
        "iacuc": row["iacuc"] or "",
        "roomId": row["room_id"] or "",
        "roomName": row["room_name"] or "",
        "manager": row["manager"] or "",
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
    key = cache_key("quantity_sheets::detail", id=sheet_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    row = conn.execute("SELECT payload FROM quantity_sheets WHERE id = ?", (sheet_id,)).fetchone()
    return cache_set(key, json.loads(row["payload"]) if row else None)


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


def get_billing_workflow_by_key(conn, business_key):
    row = conn.execute("SELECT payload FROM billing_workflows WHERE business_key = ?", (business_key,)).fetchone()
    return json.loads(row["payload"]) if row else None


def get_billing_workflow(conn, workflow_id):
    row = conn.execute("SELECT payload FROM billing_workflows WHERE id = ?", (workflow_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def get_billing_workflow_detail(conn, workflow_id):
    key = cache_key("billing_workflows::detail", workflow_id=workflow_id)
    cached = cache_get(key)
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
            json_extract(workflows.payload, '$.totalAmount') AS total_amount,
            json_extract(workflows.payload, '$.totalCageDays') AS total_cage_days,
            json_extract(workflows.payload, '$.generatedAt') AS generated_at,
            json_extract(workflows.payload, '$.sentAt') AS sent_at,
            json_extract(workflows.payload, '$.signedReturnedAt') AS signed_returned_at,
            json_extract(workflows.payload, '$.submittedToFinanceAt') AS submitted_to_finance_at,
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
    return cache_set(key, billing_workflow_detail_row(row) if row else None)


def get_billing_version(conn, version_id):
    row = conn.execute("SELECT payload FROM billing_statement_versions WHERE id = ?", (version_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def list_billing_workflows(conn):
    rows = conn.execute("SELECT payload FROM billing_workflows ORDER BY month DESC, rowid DESC").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_billing_workflows_page(conn, filters, clean_text, workflow_status_finance):
    clauses = []
    params = []
    if clean_text(filters.get("month", "")):
        clauses.append("month = ?")
        params.append(filters["month"])
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
    if clean_text(filters.get("sourceType", "")):
        clauses.append("source_type = ?")
        params.append(filters["sourceType"])
    if clean_text(filters.get("iacuc", "")):
        clauses.append("iacuc = ?")
        params.append(filters["iacuc"])
    where = " AND ".join(clauses)
    key = cache_key(
        "billing_workflows",
        limit=filters["limit"],
        offset=filters["offset"],
        status=status,
        month=clean_text(filters.get("month", "")),
        source_type=clean_text(filters.get("sourceType", "")),
        iacuc=clean_text(filters.get("iacuc", "")),
    )
    cached = cache_get(key)
    if cached is not None:
        return cached
    where_clause = f" WHERE {where}" if where else ""
    total = conn.execute(f"SELECT COUNT(*) AS total FROM billing_workflows{where_clause}", tuple(params)).fetchone()["total"]
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
            json_extract(payload, '$.totalAmount') AS total_amount,
            json_extract(payload, '$.totalCageDays') AS total_cage_days,
            json_extract(payload, '$.generatedAt') AS generated_at,
            json_extract(payload, '$.sentAt') AS sent_at,
            json_extract(payload, '$.signedReturnedAt') AS signed_returned_at,
            json_extract(payload, '$.submittedToFinanceAt') AS submitted_to_finance_at
        FROM billing_workflows{where_clause}
        ORDER BY month DESC, rowid DESC
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
    return cache_set(key, payload)


def billing_workflow_list_row(row):
    return {
        "id": row["id"] or "",
        "businessKey": row["business_key"] or "",
        "scopeType": row["scope_type"] or "",
        "scopeKey": row["scope_key"] or "",
        "iacuc": row["iacuc"] or "",
        "iacucs": _load_json_array(row["iacucs_json"]),
        "month": row["month"] or "",
        "sourceType": row["source_type"] or "",
        "workflowStatus": row["workflow_status"] or "",
        "currentVersionId": row["current_version_id"] or "",
        "currentVersionNo": row["current_version_no"] or 0,
        "latestEventAt": row["latest_event_at"] or "",
        "pi": row["pi"] or "",
        "project": row["project"] or "",
        "owner": row["owner"] or "",
        "funding": row["funding"] or "",
        "totalAmount": row["total_amount"] or 0,
        "totalCageDays": row["total_cage_days"] or 0,
        "generatedAt": row["generated_at"] or "",
        "sentAt": row["sent_at"] or "",
        "signedReturnedAt": row["signed_returned_at"] or "",
        "submittedToFinanceAt": row["submitted_to_finance_at"] or "",
    }


def billing_workflow_list_item(workflow):
    return {
        "id": workflow.get("id", ""),
        "businessKey": workflow.get("businessKey", ""),
        "scopeType": workflow.get("scopeType", ""),
        "scopeKey": workflow.get("scopeKey", ""),
        "iacuc": workflow.get("iacuc", ""),
        "iacucs": workflow.get("iacucs", []),
        "month": workflow.get("month", ""),
        "sourceType": workflow.get("sourceType", ""),
        "workflowStatus": workflow.get("workflowStatus", ""),
        "currentVersionId": workflow.get("currentVersionId", ""),
        "currentVersionNo": workflow.get("currentVersionNo", 0),
        "latestEventAt": workflow.get("latestEventAt", ""),
        "pi": workflow.get("pi", ""),
        "project": workflow.get("project", ""),
        "owner": workflow.get("owner", ""),
        "funding": workflow.get("funding", ""),
        "totalAmount": workflow.get("totalAmount", 0),
        "totalCageDays": workflow.get("totalCageDays", 0),
        "generatedAt": workflow.get("generatedAt", ""),
        "sentAt": workflow.get("sentAt", ""),
        "signedReturnedAt": workflow.get("signedReturnedAt", ""),
        "submittedToFinanceAt": workflow.get("submittedToFinanceAt", ""),
    }


def billing_workflow_detail_row(row):
    return {
        **billing_workflow_list_row(row),
        "currentVersion": billing_workflow_version_row(row, prefix="cv_") if row["cv_id"] else {},
    }


def list_billing_workflow_versions(conn, workflow_id):
    key = cache_key("billing_workflows::versions", workflow_id=workflow_id)
    cached = cache_get(key)
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
    return cache_set(key, [billing_workflow_version_row(row) for row in rows])


def billing_workflow_version_list_item(version):
    summary = dict(version.get("summary") or {})
    return {
        "id": version.get("id", ""),
        "workflowId": version.get("workflowId", ""),
        "versionNo": version.get("versionNo", 0),
        "versionStatus": version.get("versionStatus", ""),
        "workflowStatus": version.get("workflowStatus", ""),
        "generatedAt": version.get("generatedAt", ""),
        "voidedAt": version.get("voidedAt", ""),
        "voidedBy": version.get("voidedBy", ""),
        "voidReason": version.get("voidReason", ""),
        "documentNumber": version.get("documentNumber", ""),
        "summary": summary,
    }


def billing_workflow_version_row(row, prefix=""):
    return {
        "id": row[f"{prefix}id"] or "",
        "workflowId": row[f"{prefix}workflow_id"] or "",
        "versionNo": row[f"{prefix}version_no"] or 0,
        "versionStatus": row[f"{prefix}version_status"] or "",
        "workflowStatus": row[f"{prefix}workflow_status"] or "",
        "generatedAt": row[f"{prefix}generated_at"] or "",
        "voidedAt": row[f"{prefix}voided_at"] or "",
        "voidedBy": row[f"{prefix}voided_by"] or "",
        "voidReason": row[f"{prefix}void_reason"] or "",
        "documentNumber": row[f"{prefix}document_number"] or "",
        "summary": _load_json_object(row[f"{prefix}summary_json"]),
    }


def billing_workflow_detail_item(workflow):
    current_version = workflow.get("currentVersion") or {}
    payload = dict(workflow)
    payload["currentVersion"] = billing_workflow_version_list_item(current_version) if current_version else {}
    return payload


def list_billing_workflow_events(conn, workflow_id):
    key = cache_key("billing_workflows::events", workflow_id=workflow_id)
    cached = cache_get(key)
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
            json_extract(payload, '$.note') AS note
        FROM billing_workflow_events
        WHERE workflow_id = ?
        ORDER BY at DESC, rowid DESC
        """,
        (workflow_id,),
    ).fetchall()
    return cache_set(key, [billing_workflow_event_row(row) for row in rows])


def billing_workflow_event_list_item(event):
    return {
        "id": event.get("id", ""),
        "workflowId": event.get("workflowId", ""),
        "versionId": event.get("versionId", ""),
        "eventType": event.get("eventType", ""),
        "fromStatus": event.get("fromStatus", ""),
        "toStatus": event.get("toStatus", ""),
        "at": event.get("at", ""),
        "actor": {
            "id": (event.get("actor") or {}).get("id", ""),
            "username": (event.get("actor") or {}).get("username", ""),
            "displayName": (event.get("actor") or {}).get("displayName", ""),
        },
        "note": event.get("note", ""),
    }


def billing_workflow_event_row(row):
    return {
        "id": row["id"] or "",
        "workflowId": row["workflow_id"] or "",
        "versionId": row["version_id"] or "",
        "eventType": row["event_type"] or "",
        "fromStatus": row["from_status"] or "",
        "toStatus": row["to_status"] or "",
        "at": row["at"] or "",
        "actor": {
            "id": row["actor_id"] or "",
            "username": row["actor_username"] or "",
            "displayName": row["actor_display_name"] or "",
        },
        "note": row["note"] or "",
    }


def list_billing_statement_lines_for_version(conn, version_id):
    rows = conn.execute(
        "SELECT payload FROM billing_statement_version_lines WHERE version_id = ? ORDER BY line_date, rowid",
        (version_id,),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_billing_statement_line_summaries_for_version(conn, version_id):
    key = cache_key("billing_workflows::lines", version_id=version_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = conn.execute(
        """
        SELECT
            line_date,
            json_extract(payload, '$.cageCount') AS cage_count,
            json_extract(payload, '$.animalCount') AS animal_count,
            json_extract(payload, '$.freeCages') AS free_cages,
            json_extract(payload, '$.billableCages') AS billable_cages,
            json_extract(payload, '$.billableCount') AS billable_count,
            json_extract(payload, '$.amount') AS amount,
            json_extract(payload, '$.cumulative') AS cumulative
        FROM billing_statement_version_lines
        WHERE version_id = ?
        ORDER BY line_date, rowid
        """,
        (version_id,),
    ).fetchall()
    return cache_set(key, [billing_statement_line_summary_row(row) for row in rows])


def billing_statement_line_summary_row(row):
    return {
        "date": row["line_date"] or "",
        "cageCount": row["cage_count"] or 0,
        "animalCount": row["animal_count"] or 0,
        "freeCages": row["free_cages"] or 0,
        "billableCages": row["billable_cages"] if row["billable_cages"] is not None else (row["billable_count"] or 0),
        "amount": row["amount"] or 0,
        "cumulative": row["cumulative"] or 0,
    }


def billing_statement_list_item(statement):
    return {
        "id": statement.get("id", ""),
        "workflowId": statement.get("workflowId", ""),
        "versionId": statement.get("versionId", ""),
        "versionNo": statement.get("versionNo", ""),
        "versionStatus": statement.get("versionStatus", ""),
        "workflowStatus": statement.get("workflowStatus", ""),
        "documentNumber": statement.get("documentNumber", ""),
        "iacuc": statement.get("iacuc", ""),
        "iacucs": statement.get("iacucs", []),
        "month": statement.get("month", ""),
        "sourceType": statement.get("sourceType", ""),
        "pi": statement.get("pi", ""),
        "project": statement.get("project", ""),
        "owner": statement.get("owner", ""),
        "funding": statement.get("funding", ""),
        "totalAmount": statement.get("totalAmount", 0),
        "totalCageDays": statement.get("totalCageDays", 0),
        "totalAnimalDays": statement.get("totalAnimalDays", 0),
        "billingUnit": statement.get("billingUnit", ""),
        "generatedAt": statement.get("generatedAt", ""),
    }


def list_current_billing_statements(conn):
    key = "billing_statements::current"
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = conn.execute(
        """
        SELECT versions.payload
        FROM billing_workflows AS workflows
        JOIN billing_statement_versions AS versions
          ON versions.id = workflows.current_version_id
        ORDER BY workflows.month DESC, workflows.rowid DESC
        """
    ).fetchall()
    statements = []
    for row in rows:
        version = json.loads(row["payload"])
        statement = dict(version.get("statement") or {})
        if statement:
            statements.append(billing_statement_list_item(statement))
    return cache_set(key, statements)


def get_current_billing_statement(conn, statement_id):
    key = cache_key("billing_statements::current_item", id=statement_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    row = conn.execute(
        """
        SELECT versions.payload
        FROM billing_statement_versions AS versions
        JOIN billing_workflows AS workflows
          ON workflows.current_version_id = versions.id
        WHERE versions.id = ?
        """,
        (statement_id,),
    ).fetchone()
    if not row:
        return cache_set(key, None)
    version = json.loads(row["payload"])
    statement = dict(version.get("statement") or {})
    if not statement:
        return cache_set(key, None)
    return cache_set(key, billing_statement_list_item(statement))


def insert_quantity_sheet(conn, sheet, db_values):
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


def update_quantity_sheet(conn, sheet, db_values):
    conn.execute(
        """
        UPDATE quantity_sheets
        SET month = ?, iacuc = ?, room_id = ?, room_name = ?, manager = ?,
            project = ?, pi = ?, owner = ?, funding = ?, updated_at = ?, payload = ?
        WHERE id = ?
        """,
        db_values + (sheet["id"],),
    )


def delete_quantity_sheet_by_id(conn, sheet_id):
    conn.execute("DELETE FROM quantity_sheets WHERE id = ?", (sheet_id,))


def select_quantity_sheets_for_transfer(conn, month, source_sheet_id, target_iacucs, source_row_ids):
    where_parts = ["month = ?", "id != ?"]
    params = [month, source_sheet_id]
    mirror_clauses = ["payload LIKE ?" for _ in source_row_ids] if source_row_ids else ["payload LIKE ?"]
    if target_iacucs:
        placeholders = ", ".join("?" for _ in target_iacucs)
        where_parts.append(f"(iacuc IN ({placeholders}) OR {' OR '.join(mirror_clauses)})")
        params.extend(target_iacucs)
        params.extend([f"%{source_sheet_id}:{row_id}:%" for row_id in source_row_ids] or [f"%{source_sheet_id}%"])
    else:
        where_parts.append(f"({' OR '.join(mirror_clauses)})")
        params.extend([f"%{source_sheet_id}:{row_id}:%" for row_id in source_row_ids] or [f"%{source_sheet_id}%"])
    rows = conn.execute(
        f"SELECT id, payload FROM quantity_sheets WHERE {' AND '.join(where_parts)}",
        params,
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def insert_billing_workflow(conn, payload, business_key, workflow_status, current_version_no):
    conn.execute(
        """
        INSERT INTO billing_workflows (
            id, business_key, iacuc, month, source_type, workflow_status,
            current_version_id, current_version_no, latest_event_at, payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload["id"],
            business_key,
            payload.get("iacuc", ""),
            payload.get("month", ""),
            payload.get("sourceType", ""),
            workflow_status,
            payload.get("currentVersionId", ""),
            current_version_no,
            payload.get("latestEventAt", ""),
            dump_json(payload),
        ),
    )


def update_billing_workflow(conn, payload, business_key, workflow_status, current_version_no):
    conn.execute(
        """
        UPDATE billing_workflows
        SET business_key = ?, iacuc = ?, month = ?, source_type = ?, workflow_status = ?,
            current_version_id = ?, current_version_no = ?, latest_event_at = ?, payload = ?
        WHERE id = ?
        """,
        (
            business_key,
            payload.get("iacuc", ""),
            payload.get("month", ""),
            payload.get("sourceType", ""),
            workflow_status,
            payload.get("currentVersionId", ""),
            current_version_no,
            payload.get("latestEventAt", ""),
            dump_json(payload),
            payload["id"],
        ),
    )


def insert_billing_version(conn, payload, version_no, version_status, workflow_status):
    conn.execute(
        """
        INSERT INTO billing_statement_versions (
            id, workflow_id, version_no, version_status, workflow_status,
            generated_at, voided_at, created_by, payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload["id"],
            payload.get("workflowId", ""),
            version_no,
            version_status,
            workflow_status,
            payload.get("generatedAt", ""),
            payload.get("voidedAt", ""),
            payload.get("statement", {}).get("createdBy", ""),
            dump_json(payload),
        ),
    )


def update_billing_version(conn, payload, version_no, version_status, workflow_status):
    conn.execute(
        """
        UPDATE billing_statement_versions
        SET version_no = ?, version_status = ?, workflow_status = ?, generated_at = ?,
            voided_at = ?, created_by = ?, payload = ?
        WHERE id = ?
        """,
        (
            version_no,
            version_status,
            workflow_status,
            payload.get("generatedAt", ""),
            payload.get("voidedAt", ""),
            payload.get("statement", {}).get("createdBy", ""),
            dump_json(payload),
            payload["id"],
        ),
    )


def replace_billing_statement_version_lines(conn, version_id, lines):
    conn.execute("DELETE FROM billing_statement_version_lines WHERE version_id = ?", (version_id,))
    for index, line in enumerate(lines, start=1):
        normalized = {**line, "versionId": version_id}
        line_id = normalized.get("id") or f"{version_id}-line-{index}"
        conn.execute(
            """
            INSERT INTO billing_statement_version_lines (id, version_id, line_date, payload)
            VALUES (?, ?, ?, ?)
            """,
            (line_id, version_id, normalized.get("date", ""), dump_json(normalized)),
        )


def insert_billing_workflow_event(conn, payload):
    conn.execute(
        """
        INSERT INTO billing_workflow_events (
            id, workflow_id, version_id, event_type, from_status, to_status, at, payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload["id"],
            payload.get("workflowId", ""),
            payload.get("versionId", ""),
            payload.get("eventType", ""),
            payload.get("fromStatus", ""),
            payload.get("toStatus", ""),
            payload.get("at", ""),
            dump_json(payload),
        ),
    )


def delete_billing_workflow_tree(conn, workflow_id):
    conn.execute(
        """
        DELETE FROM billing_statement_version_lines
        WHERE version_id IN (
            SELECT id FROM billing_statement_versions WHERE workflow_id = ?
        )
        """,
        (workflow_id,),
    )
    conn.execute("DELETE FROM billing_workflow_events WHERE workflow_id = ?", (workflow_id,))
    conn.execute("DELETE FROM billing_statement_versions WHERE workflow_id = ?", (workflow_id,))
    conn.execute("DELETE FROM billing_workflows WHERE id = ?", (workflow_id,))


def _load_json_array(value):
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _load_json_object(value):
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}
