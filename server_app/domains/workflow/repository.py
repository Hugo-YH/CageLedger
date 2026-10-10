from server_app.repositories.billing_statements import *  # noqa: F403
from server_app.repositories.billing_workflows import *  # noqa: F403


def list_workflow_withdrawal_owners(conn, workflow_ids):
    ids = sorted({value for value in workflow_ids if value})
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"""SELECT w.id, w.workflow_status,
            (SELECT json_extract(e.payload, '$.actor.id')
             FROM billing_workflow_events e
             WHERE e.workflow_id = w.id AND e.version_id = w.current_version_id
               AND e.event_type IN ('statement_generated', 'statement_revised')
             ORDER BY e.at DESC, e.rowid DESC LIMIT 1) AS generated_by,
            COALESCE(NULLIF(json_extract(w.payload, '$.sentBy.id'), ''),
                (SELECT json_extract(e.payload, '$.actor.id')
                 FROM billing_workflow_events e
                 WHERE e.workflow_id = w.id AND e.version_id = w.current_version_id
                   AND e.event_type = 'statement_sent'
                 ORDER BY e.at DESC, e.rowid DESC LIMIT 1)) AS sent_by
            FROM billing_workflows w WHERE w.id IN ({placeholders})""",
        ids,
    ).fetchall()
    return {
        row["id"]: {"status": row["workflow_status"], "generatedBy": row["generated_by"], "sentBy": row["sent_by"]}
        for row in rows
    }
