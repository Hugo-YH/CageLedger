import json

from server_app.repositories.billing_statements import *  # noqa: F403
from server_app.repositories.billing_workflows import *  # noqa: F403

from .rules import unlock_status


def unlock_targets(conn, workflow_ids):
    if not workflow_ids:
        return {}
    placeholders = ",".join("?" for _ in workflow_ids)
    rows = conn.execute(
        f"""SELECT w.id, json_extract(v.payload, '$.statement') AS statement
            FROM billing_workflows w JOIN billing_statement_versions v ON v.id=w.current_version_id
            WHERE w.id IN ({placeholders})""",
        workflow_ids,
    ).fetchall()
    return {row["id"]: unlock_status(json.loads(row["statement"] or "{}")) for row in rows}


def list_workflow_handlers(conn, workflow_ids, actor_id):
    ids = sorted({value for value in workflow_ids if value})
    if not ids:
        return {}, set()
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"SELECT id, workflow_status, payload FROM billing_workflows WHERE id IN ({placeholders})",
        ids,
    ).fetchall()
    statuses = {row["id"]: row["workflow_status"] for row in rows}
    handled = set()
    if not actor_id:
        return statuses, handled
    for row in rows:
        payload = json.loads(row["payload"])
        if any(
            isinstance(payload.get(key), dict) and payload[key].get("id") == actor_id
            for key in ("sentBy", "registeredBy", "reimbursementRecordedBy")
        ):
            handled.add(row["id"])
    events = conn.execute(
        f"""SELECT DISTINCT workflow_id FROM billing_workflow_events
            WHERE workflow_id IN ({placeholders}) AND json_extract(payload, '$.actor.id') = ?
              AND event_type IN ('statement_generated', 'statement_revised', 'statement_sent',
                  'statement_registered_archived', 'statement_reimbursement_recorded')""",
        [*ids, actor_id],
    ).fetchall()
    handled.update(row["workflow_id"] for row in events)
    versions = conn.execute(
        f"SELECT workflow_id, payload FROM billing_statement_versions WHERE workflow_id IN ({placeholders})",
        ids,
    ).fetchall()
    sources = {}
    technical_sources = {}
    legacy = {}
    for row in versions:
        statement = json.loads(row["payload"]).get("statement") or {}
        if statement.get("sourceType") == "pi_merged_technical_service":
            for source_id in statement.get("sourceIds", []):
                technical_sources.setdefault(source_id, set()).add(row["workflow_id"])
            continue
        if statement.get("sourceType") not in ("quantity_sheet", "pi_merged_quantity_sheet"):
            continue
        source_ids = statement.get("sourceIds")
        if not isinstance(source_ids, list):
            source_ids = [statement["sourceId"]] if statement.get("sourceId") else []
        source_ids = [value for value in source_ids if isinstance(value, str) and value]
        if source_ids:
            for source_id in source_ids:
                sources.setdefault(source_id, set()).add(row["workflow_id"])
        else:
            # Old versions must match the frozen month / PI / IACUC scope, never a staff name.
            for iacuc in statement.get("iacucs") or [statement.get("iacuc")]:
                key = (statement.get("month"), statement.get("pi"), iacuc)
                if all(key):
                    legacy.setdefault(key, set()).add(row["workflow_id"])
    if legacy:
        pairs = sorted({key[:2] for key in legacy})
        pairs_sql = ",".join("(?,?)" for _ in pairs)
        sheets = conn.execute(
            f"SELECT id, month, pi, iacuc FROM quantity_sheets WHERE (month, pi) IN ({pairs_sql})",
            [value for pair in pairs for value in pair],
        ).fetchall()
        for sheet in sheets:
            matches = legacy.get((sheet["month"], sheet["pi"], sheet["iacuc"]), set())
            if matches:
                sources.setdefault(sheet["id"], set()).update(matches)
    if sources:
        source_ids = list(sources)
        for offset in range(0, len(source_ids), 400):
            batch = source_ids[offset : offset + 400]
            source_sql = ",".join("?" for _ in batch)
            audits = conn.execute(
                f"""SELECT DISTINCT entity_id FROM audit_events
                WHERE entity_type = 'quantity_sheet' AND entity_id IN ({source_sql}) AND actor_user_id = ?
                  AND action IN ('quantity_sheet.created', 'quantity_sheet.updated',
                      'quantity_sheet.transfer_placeholder_created', 'quantity_sheet.transfer_synced')""",
                [*batch, actor_id],
            ).fetchall()
            for audit in audits:
                handled.update(sources[audit["entity_id"]])
    for identity, workflows in technical_sources.items():
        audit = conn.execute(
            """SELECT 1 FROM audit_events WHERE entity_type='technical_service_sheet'
            AND entity_id=? AND actor_user_id=? AND action IN ('technical_service.created','technical_service.updated')
            LIMIT 1""",
            (identity, actor_id),
        ).fetchone()
        if audit:
            handled.update(workflows)
    return statuses, handled
