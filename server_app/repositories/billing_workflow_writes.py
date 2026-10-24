"""Workflow/version/event inserts, updates and tree deletion."""

from .payload import dump_json


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
    from .billing_snapshot_storage import delete_workflow_snapshot_data

    delete_workflow_snapshot_data(conn, workflow_id)
    conn.execute("DELETE FROM billing_workflow_events WHERE workflow_id = ?", (workflow_id,))
    conn.execute("DELETE FROM billing_statement_versions WHERE workflow_id = ?", (workflow_id,))
    conn.execute("DELETE FROM billing_workflows WHERE id = ?", (workflow_id,))
