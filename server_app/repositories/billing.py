import json

from .payload import cached_paginated_payloads, dump_json


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
    return cached_paginated_payloads(conn, "quantity_sheets", "quantity_sheets", "month DESC, iacuc, updated_at DESC", filters, where, params)


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
    elif status:
        clauses.append("workflow_status = ?")
        params.append(status)
    if clean_text(filters.get("sourceType", "")):
        clauses.append("source_type = ?")
        params.append(filters["sourceType"])
    if clean_text(filters.get("iacuc", "")):
        clauses.append("iacuc = ?")
        params.append(filters["iacuc"])
    where = " AND ".join(clauses)
    return cached_paginated_payloads(conn, "billing_workflows", "billing_workflows", "month DESC, rowid DESC", filters, where, tuple(params))


def list_billing_workflow_versions(conn, workflow_id):
    rows = conn.execute(
        "SELECT payload FROM billing_statement_versions WHERE workflow_id = ? ORDER BY version_no DESC, rowid DESC",
        (workflow_id,),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_billing_workflow_events(conn, workflow_id):
    rows = conn.execute(
        "SELECT payload FROM billing_workflow_events WHERE workflow_id = ? ORDER BY at DESC, rowid DESC",
        (workflow_id,),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_billing_statement_lines_for_version(conn, version_id):
    rows = conn.execute(
        "SELECT payload FROM billing_statement_version_lines WHERE version_id = ? ORDER BY line_date, rowid",
        (version_id,),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_current_billing_statements(conn):
    statements = []
    for workflow in list_billing_workflows(conn):
        current_version = workflow.get("currentVersion") or {}
        statement = dict((current_version.get("statement") or {}))
        if statement:
            statements.append(statement)
    return statements


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
