"""Billing workflow application transactions and attachments."""

import hashlib
import json
import mimetypes

from server_app.cache import invalidate_data_cache_prefixes
from server_app.config import REIMBURSEMENT_ATTACHMENTS_PATH
from server_app.domains.administration import audit_event, merge_audit_logs, write_audit_events
from server_app.domains.workflow.constants import (
    VERSION_STATUS_ACTIVE,
    VERSION_STATUS_VOIDED,
    WORKFLOW_STATUS_ARCHIVED,
    WORKFLOW_STATUS_FINANCE,
    WORKFLOW_STATUS_GENERATED,
    WORKFLOW_STATUS_LOCKED,
    WORKFLOW_STATUS_SENT,
    WORKFLOW_STATUS_SIGNED,
)
from server_app.domains.workflow.facade import get_billing_version, get_billing_workflow, get_billing_workflow_by_key
from server_app.domains.workflow.payloads import (
    billing_workflow_business_key,
    build_version_payload,
    build_workflow_event_payload,
    build_workflow_payload,
    enrich_statement_for_workflow,
    make_statement_document_number,
    normalize_workflow_source,
    workflow_scope_for_statement,
)
from server_app.domains.workflow.persistence import (
    insert_billing_version,
    insert_billing_workflow,
    insert_billing_workflow_event,
    replace_version_lines,
    update_billing_version,
    update_billing_workflow,
)
from server_app.domains.workflow.service import (
    WorkflowServicePorts,
)
from server_app.domains.workflow.service import (
    record_archived_reimbursement as record_archived_reimbursement_service,
)
from server_app.domains.workflow.service import (
    save_billing_statement_workflow as save_billing_statement_workflow_service,
)
from server_app.domains.workflow.service import (
    update_workflow_status as update_workflow_status_service,
)
from server_app.shared import as_float, as_int, clean_text, new_id, now_iso


def workflow_service_ports():
    return WorkflowServicePorts(
        VERSION_STATUS_ACTIVE=VERSION_STATUS_ACTIVE,
        VERSION_STATUS_VOIDED=VERSION_STATUS_VOIDED,
        WORKFLOW_STATUS_FINANCE=WORKFLOW_STATUS_FINANCE,
        WORKFLOW_STATUS_GENERATED=WORKFLOW_STATUS_GENERATED,
        WORKFLOW_STATUS_SENT=WORKFLOW_STATUS_SENT,
        WORKFLOW_STATUS_SIGNED=WORKFLOW_STATUS_SIGNED,
        WORKFLOW_STATUS_ARCHIVED=WORKFLOW_STATUS_ARCHIVED,
        WORKFLOW_STATUS_LOCKED=WORKFLOW_STATUS_LOCKED,
        as_float=as_float,
        as_int=as_int,
        billing_workflow_business_key=billing_workflow_business_key,
        build_version_payload=build_version_payload,
        build_workflow_event_payload=build_workflow_event_payload,
        build_workflow_payload=build_workflow_payload,
        clean_text=clean_text,
        enrich_statement_for_workflow=enrich_statement_for_workflow,
        get_billing_version=get_billing_version,
        get_billing_workflow=get_billing_workflow,
        get_billing_workflow_by_key=get_billing_workflow_by_key,
        insert_billing_version=insert_billing_version,
        insert_billing_workflow=insert_billing_workflow,
        insert_billing_workflow_event=insert_billing_workflow_event,
        make_statement_document_number=make_statement_document_number,
        new_id=new_id,
        normalize_workflow_source=normalize_workflow_source,
        now_iso=now_iso,
        replace_version_lines=replace_version_lines,
        update_billing_version=update_billing_version,
        update_billing_workflow=update_billing_workflow,
        workflow_scope_for_statement=workflow_scope_for_statement,
    )


def save_billing_statement_workflow(conn, statement, lines, actor, note=""):
    result = save_billing_statement_workflow_service(conn, statement, lines, actor, note, workflow_service_ports())
    invalidate_data_cache_prefixes("billing_workflows::", "billing_statements::", "reimbursement_records::")
    return result


def update_workflow_status(conn, workflow_id, next_status, actor, note="", registration=None):
    if next_status == WORKFLOW_STATUS_ARCHIVED and registration is not None:
        rows = conn.execute(
            """SELECT id, kind, original_name, mime_type, size_bytes, created_by_name, created_at
               FROM billing_workflow_attachments WHERE workflow_id = ? ORDER BY created_at""",
            (workflow_id,),
        ).fetchall()
        registration = dict(registration)
        registration["attachments"] = [
            {
                "id": row["id"],
                "kind": row["kind"],
                "originalName": row["original_name"],
                "mimeType": row["mime_type"],
                "sizeBytes": row["size_bytes"],
                "createdByName": row["created_by_name"],
                "createdAt": row["created_at"],
            }
            for row in rows
        ]
    return update_workflow_status_service(
        conn, workflow_id, next_status, actor, note, workflow_service_ports(), registration
    )


def record_archived_reimbursement(conn, workflow_id, reimbursement_forms, actor, note=""):
    return record_archived_reimbursement_service(
        conn,
        workflow_id,
        reimbursement_forms,
        actor,
        note,
        workflow_service_ports(),
    )


def add_billing_workflow_attachment(conn, actor, workflow_id, kind, filename, body, content_type):
    workflow = get_billing_workflow(conn, workflow_id)
    if not workflow:
        raise LookupError("结算流程不存在")
    if kind not in ("settlement", "reimbursement"):
        raise ValueError("附件类型仅支持 settlement 或 reimbursement")
    if not filename or not body:
        raise ValueError("附件文件不能为空")
    if len(body) > 30 * 1024 * 1024:
        raise ValueError("单个附件不能超过 30 MiB")
    mime_type, _ = mimetypes.guess_type(filename or "")
    if mime_type not in ("application/pdf", "image/jpeg", "image/png"):
        raise ValueError("仅支持 PDF、JPEG 或 PNG 附件")
    digest = hashlib.sha256(body).hexdigest()
    attachment_id = new_id("bwf-att")
    suffix = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}[mime_type]
    stored_name = f"{attachment_id}{suffix}"
    target = REIMBURSEMENT_ATTACHMENTS_PATH / "workflows" / workflow_id / stored_name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    now = now_iso()
    item = {
        "id": attachment_id,
        "workflowId": workflow_id,
        "kind": kind,
        "originalName": clean_text(filename) or stored_name,
        "storedName": stored_name,
        "mimeType": mime_type,
        "sizeBytes": len(body),
        "sha256": digest,
        "createdBy": actor.get("id", ""),
        "createdByName": actor.get("displayName", ""),
        "createdAt": now,
    }
    conn.execute(
        """INSERT INTO billing_workflow_attachments
           (id, workflow_id, kind, original_name, stored_name, mime_type, size_bytes, sha256,
            created_by, created_by_name, created_at, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            item["id"],
            item["workflowId"],
            item["kind"],
            item["originalName"],
            item["storedName"],
            item["mimeType"],
            item["sizeBytes"],
            item["sha256"],
            item["createdBy"],
            item["createdByName"],
            item["createdAt"],
            json.dumps(item, ensure_ascii=False),
        ),
    )
    event = audit_event(
        actor,
        "billing_workflow.attachment_uploaded",
        "billing_workflow_attachment",
        attachment_id,
        f"{actor['displayName']} 上传结算流程附件 {item['originalName']}",
        [],
        now,
        None,
        item,
    )
    write_audit_events(conn, [event])
    conn.commit()
    return {"item": item, "auditLogs": merge_audit_logs([], [event])}


def get_billing_workflow_attachment(conn, actor, attachment_id):
    row = conn.execute("SELECT * FROM billing_workflow_attachments WHERE id = ?", (attachment_id,)).fetchone()
    if not row:
        raise LookupError("结算流程附件不存在")
    item = {
        "id": row["id"],
        "workflowId": row["workflow_id"],
        "kind": row["kind"],
        "originalName": row["original_name"],
        "storedName": row["stored_name"],
        "mimeType": row["mime_type"],
        "sizeBytes": row["size_bytes"],
        "createdByName": row["created_by_name"],
        "createdAt": row["created_at"],
    }
    target = REIMBURSEMENT_ATTACHMENTS_PATH / "workflows" / item["workflowId"] / item["storedName"]
    if not target.is_file():
        raise LookupError("结算流程附件文件不存在")
    return item, target.read_bytes()
