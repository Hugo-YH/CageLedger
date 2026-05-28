import json

from server_app.cache import cache_get, cache_key, cache_set

from .payload import dump_json


def list_quantity_sheets(conn):
    rows = conn.execute("SELECT payload FROM quantity_sheets ORDER BY month DESC, iacuc, updated_at DESC").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_quantity_sheets_page(conn, filters, filtered_where):
    where, params = filtered_where(
        [
            ("month", "month = ?"),
            ("iacuc", "iacuc = ?"),
            ("pi", "pi = ?"),
            ("roomId", "room_id = ?"),
        ],
        filters,
    )
    key = cache_key(
        "quantity_sheets",
        limit=filters["limit"],
        offset=filters["offset"],
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
        SELECT payload
        FROM quantity_sheets{where_clause}
        ORDER BY month DESC, iacuc, updated_at DESC
        LIMIT ? OFFSET ?
        """,
        (*params, filters["limit"], filters["offset"]),
    ).fetchall()
    payload = {
        "items": [quantity_sheet_list_item(json.loads(row["payload"])) for row in rows],
        "page": {
            "limit": filters["limit"],
            "offset": filters["offset"],
            "total": total,
            "hasMore": filters["offset"] + filters["limit"] < total,
        },
    }
    return cache_set(key, payload)


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
    row = conn.execute("SELECT payload FROM quantity_sheets WHERE id = ?", (sheet_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def get_billing_workflow_by_key(conn, business_key):
    row = conn.execute("SELECT payload FROM billing_workflows WHERE business_key = ?", (business_key,)).fetchone()
    return json.loads(row["payload"]) if row else None


def get_billing_workflow(conn, workflow_id):
    row = conn.execute("SELECT payload FROM billing_workflows WHERE id = ?", (workflow_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


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
        SELECT payload
        FROM billing_workflows{where_clause}
        ORDER BY month DESC, rowid DESC
        LIMIT ? OFFSET ?
        """,
        (*params, filters["limit"], filters["offset"]),
    ).fetchall()
    payload = {
        "items": [billing_workflow_list_item(json.loads(row["payload"])) for row in rows],
        "page": {
            "limit": filters["limit"],
            "offset": filters["offset"],
            "total": total,
            "hasMore": filters["offset"] + filters["limit"] < total,
        },
    }
    return cache_set(key, payload)


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


def list_billing_workflow_versions(conn, workflow_id):
    rows = conn.execute(
        "SELECT payload FROM billing_statement_versions WHERE workflow_id = ? ORDER BY version_no DESC, rowid DESC",
        (workflow_id,),
    ).fetchall()
    return [billing_workflow_version_list_item(json.loads(row["payload"])) for row in rows]


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


def billing_workflow_detail_item(workflow):
    current_version = workflow.get("currentVersion") or {}
    payload = dict(workflow)
    payload["currentVersion"] = billing_workflow_version_list_item(current_version) if current_version else {}
    return payload


def list_billing_workflow_events(conn, workflow_id):
    rows = conn.execute(
        "SELECT payload FROM billing_workflow_events WHERE workflow_id = ? ORDER BY at DESC, rowid DESC",
        (workflow_id,),
    ).fetchall()
    return [billing_workflow_event_list_item(json.loads(row["payload"])) for row in rows]


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


def list_billing_statement_lines_for_version(conn, version_id):
    rows = conn.execute(
        "SELECT payload FROM billing_statement_version_lines WHERE version_id = ? ORDER BY line_date, rowid",
        (version_id,),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


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
    row = conn.execute("SELECT payload FROM billing_statement_versions WHERE id = ?", (statement_id,)).fetchone()
    if not row:
        return None
    version = json.loads(row["payload"])
    statement = dict(version.get("statement") or {})
    if not statement:
        return None
    workflow = get_billing_workflow(conn, version.get("workflowId", ""))
    if workflow and (workflow.get("currentVersionId") or "") != statement_id:
        return None
    return statement


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
