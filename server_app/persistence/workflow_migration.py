"""Migration of legacy billing statements into versioned billing workflows."""

import json
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class BillingWorkflowMigrationPorts:
    read_setting: Callable
    table_has_rows: Callable
    set_setting: Callable
    now_iso: Callable
    normalize_source: Callable
    workflow_scope: Callable
    business_key: Callable
    new_id: Callable
    dump_json: Callable
    document_number: Callable
    enrich_statement: Callable
    build_version: Callable
    build_event: Callable
    build_workflow: Callable


def migrate_billing_workflow_schema(
    conn,
    ports: BillingWorkflowMigrationPorts,
    *,
    migration_key: str,
    generated_status: str,
    active_version_status: str,
    voided_version_status: str,
):
    if ports.read_setting(conn, migration_key, False):
        return
    if ports.table_has_rows(conn, "billing_workflows") or not ports.table_has_rows(conn, "billing_statements"):
        ports.set_setting(conn, migration_key, True, ports.now_iso())
        return

    rows = conn.execute(
        "SELECT id, payload, generated_at, rowid FROM billing_statements ORDER BY month, iacuc, generated_at, rowid"
    ).fetchall()
    grouped = {}
    for row in rows:
        statement = json.loads(row["payload"])
        source_type = ports.normalize_source(statement.get("sourceType", ""))
        scope_type, scope_key = ports.workflow_scope(statement)
        key = ports.business_key(scope_type, scope_key, statement.get("month", ""), source_type)
        grouped.setdefault(key, []).append((row, statement, source_type))

    for items in grouped.values():
        _migrate_workflow_group(
            conn,
            items,
            ports,
            generated_status=generated_status,
            active_version_status=active_version_status,
            voided_version_status=voided_version_status,
        )
    ports.set_setting(conn, migration_key, True, ports.now_iso())


def _migrate_workflow_group(
    conn,
    items,
    ports,
    *,
    generated_status,
    active_version_status,
    voided_version_status,
):
    first_statement = items[0][1]
    source_type = items[0][2]
    workflow_id = ports.new_id("bwf")
    conn.execute(
        """
        INSERT INTO billing_workflows (
            id, business_key, iacuc, month, source_type, workflow_status,
            current_version_id, current_version_no, latest_event_at, payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            workflow_id,
            ports.business_key(*ports.workflow_scope(first_statement), first_statement.get("month", ""), source_type),
            first_statement.get("iacuc", ""),
            first_statement.get("month", ""),
            source_type,
            generated_status,
            "",
            0,
            "",
            ports.dump_json({"id": workflow_id, "migrationPending": True}),
        ),
    )
    versions = []
    latest_at = ""
    for index, (row, statement, _grouped_source) in enumerate(items, start=1):
        generated_at = statement.get("generatedAt") or row["generated_at"] or ports.now_iso()
        lines = [
            json.loads(line_row["payload"])
            for line_row in conn.execute(
                "SELECT payload FROM billing_statement_lines WHERE statement_id = ? ORDER BY line_date, rowid",
                (row["id"],),
            ).fetchall()
        ]
        version_status = active_version_status if index == len(items) else voided_version_status
        document_number = statement.get("documentNumber") or ports.document_number(statement, index)
        enriched = ports.enrich_statement(
            statement,
            workflow_id=workflow_id,
            version_id=row["id"],
            version_no=index,
            version_status=version_status,
            workflow_status=generated_status,
            document_number=document_number,
        )
        version_payload = ports.build_version(
            enriched,
            workflow_id,
            index,
            version_status,
            generated_status,
            generated_at,
            "",
            "",
            "",
        )
        conn.execute(
            """
            INSERT INTO billing_statement_versions (
                id, workflow_id, version_no, version_status, workflow_status,
                generated_at, voided_at, created_by, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["id"],
                workflow_id,
                index,
                version_status,
                generated_status,
                generated_at,
                generated_at if version_status == voided_version_status else "",
                "",
                ports.dump_json(version_payload),
            ),
        )
        for line in lines:
            conn.execute(
                """
                INSERT INTO billing_statement_version_lines (id, version_id, line_date, payload)
                VALUES (?, ?, ?, ?)
                """,
                (line.get("id") or ports.new_id("line"), row["id"], line.get("date", ""), ports.dump_json(line)),
            )
        event = ports.build_event(
            ports.new_id("wevt"),
            workflow_id,
            row["id"],
            "statement_generated",
            "",
            generated_status,
            {"displayName": "系统迁移", "username": "system", "id": "system"},
            generated_at,
            "system",
            "由旧版 billing_statements 迁移生成",
        )
        conn.execute(
            """
            INSERT INTO billing_workflow_events (
                id, workflow_id, version_id, event_type, from_status, to_status, at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event["id"],
                workflow_id,
                row["id"],
                event["eventType"],
                event["fromStatus"],
                event["toStatus"],
                event["at"],
                ports.dump_json(event),
            ),
        )
        versions.append(version_payload)
        latest_at = max(latest_at, generated_at)

    current_version = versions[-1]
    workflow = ports.build_workflow(
        workflow_id,
        first_statement.get("iacuc", ""),
        first_statement.get("month", ""),
        source_type,
        generated_status,
        current_version,
        latest_at,
    )
    conn.execute(
        """
        UPDATE billing_workflows
        SET business_key = ?, iacuc = ?, month = ?, source_type = ?,
            workflow_status = ?, current_version_id = ?, current_version_no = ?,
            latest_event_at = ?, payload = ?
        WHERE id = ?
        """,
        (
            workflow.get("businessKey", ""),
            first_statement.get("iacuc", ""),
            first_statement.get("month", ""),
            source_type,
            generated_status,
            current_version["id"],
            current_version["versionNo"],
            latest_at,
            ports.dump_json(workflow),
            workflow_id,
        ),
    )


def backfill_billing_workflow_scope(conn, ports: BillingWorkflowMigrationPorts):
    rows = conn.execute("SELECT id, payload FROM billing_workflows").fetchall()
    for row in rows:
        workflow = json.loads(row["payload"])
        statement = (workflow.get("currentVersion") or {}).get("statement") or {}
        scope_type, scope_key = ports.workflow_scope(statement)
        desired_key = ports.business_key(
            scope_type, scope_key, workflow.get("month", ""), workflow.get("sourceType", "")
        )
        conflict = conn.execute(
            "SELECT id FROM billing_workflows WHERE business_key = ? AND id != ?", (desired_key, row["id"])
        ).fetchone()
        if conflict:
            desired_key = f"{desired_key}|legacy|{row['id']}"
        if (
            workflow.get("scopeType") == scope_type
            and workflow.get("scopeKey") == scope_key
            and desired_key == workflow.get("businessKey")
        ):
            continue
        workflow["scopeType"] = scope_type
        workflow["scopeKey"] = scope_key
        workflow["businessKey"] = desired_key
        workflow["iacucs"] = statement.get("iacucs", workflow.get("iacucs", []))
        conn.execute(
            "UPDATE billing_workflows SET business_key = ?, payload = ? WHERE id = ?",
            (desired_key, ports.dump_json(workflow), row["id"]),
        )
