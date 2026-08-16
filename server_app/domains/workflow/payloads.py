"""Billing workflow payload contracts and business keys."""

import re

from server_app.shared import as_float, clean_text


def normalize_workflow_source(source_type):
    text = clean_text(source_type or "")
    return text if text else "cage_map"


def workflow_scope_for_statement(statement):
    source_type = normalize_workflow_source(statement.get("sourceType", ""))
    pi_name = clean_text(statement.get("pi", ""))
    if source_type.startswith("pi_merged_") and pi_name:
        return "pi", f"pi::{pi_name}"
    if source_type in ("cage_map", "quantity_sheet") and pi_name:
        return "pi", f"pi::{pi_name}"
    iacuc = clean_text(statement.get("iacuc", ""))
    return "iacuc", iacuc


def billing_workflow_business_key(scope_type, scope_key, month, source_type):
    return "|".join(
        [clean_text(scope_type), clean_text(scope_key), clean_text(month), normalize_workflow_source(source_type)]
    )


def make_statement_document_number(statement, version_no):
    source = normalize_workflow_source(statement.get("sourceType", ""))
    source_code = {
        "quantity_sheet": "QS",
        "pi_merged_quantity_sheet": "PQS",
        "pi_merged_cage_map": "PCM",
    }.get(source, "CM")
    month = re.sub(r"\D", "", clean_text(statement.get("month", "")) or "000000")
    iacuc = re.sub(r"[^A-Za-z0-9]", "", clean_text(statement.get("iacuc", "")) or "UNKNOWN").upper()
    return f"CL-{source_code}-{month}-{iacuc}-V{int(version_no):02d}"


def enrich_statement_for_workflow(
    statement,
    *,
    workflow_id,
    version_id,
    version_no,
    version_status,
    workflow_status,
    document_number,
):
    return {
        **statement,
        "id": version_id,
        "workflowId": workflow_id,
        "versionId": version_id,
        "versionNo": version_no,
        "versionStatus": version_status,
        "workflowStatus": workflow_status,
        "documentNumber": document_number,
    }


def build_version_payload(
    statement,
    workflow_id,
    version_no,
    version_status,
    workflow_status,
    generated_at,
    voided_at,
    voided_by,
    void_reason,
):
    return {
        "id": statement["id"],
        "workflowId": workflow_id,
        "versionNo": version_no,
        "versionStatus": version_status,
        "workflowStatus": workflow_status,
        "generatedAt": generated_at,
        "voidedAt": voided_at,
        "voidedBy": voided_by,
        "voidReason": void_reason,
        "documentNumber": statement.get("documentNumber", ""),
        "statement": statement,
        "summary": {
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
            "status": statement.get("status", "draft"),
        },
    }


def build_workflow_payload(workflow_id, iacuc, month, source_type, workflow_status, current_version, latest_event_at):
    statement = current_version.get("statement", {})
    scope_type, scope_key = workflow_scope_for_statement(statement)
    timestamps = {
        "generatedAt": current_version.get("generatedAt", ""),
        "sentAt": statement.get("sentAt", ""),
        "signedReturnedAt": statement.get("signedReturnedAt", ""),
        "submittedToFinanceAt": statement.get("submittedToFinanceAt", ""),
        "registeredAt": statement.get("registeredAt", ""),
        "archivedAt": statement.get("archivedAt", ""),
    }
    if statement.get("sentBy"):
        timestamps["sentBy"] = statement["sentBy"]
    workflow_payload = {
        "id": workflow_id,
        "businessKey": billing_workflow_business_key(scope_type, scope_key, month, source_type),
        "scopeType": scope_type,
        "scopeKey": scope_key,
        "iacuc": iacuc,
        "iacucs": statement.get("iacucs", []),
        "month": month,
        "sourceType": source_type,
        "workflowStatus": workflow_status,
        "currentVersionId": current_version.get("id", ""),
        "currentVersionNo": current_version.get("versionNo", 0),
        "currentVersion": current_version,
        "latestEventAt": latest_event_at,
        "pi": statement.get("pi", ""),
        "project": statement.get("project", ""),
        "owner": statement.get("owner", ""),
        "funding": statement.get("funding", ""),
        "manager": statement.get("manager", ""),
        "totalAmount": statement.get("totalAmount", 0),
        "totalCageDays": statement.get("totalCageDays", 0),
        "reimbursementRequired": (as_float(statement.get("totalAmount")) or 0) > 0,
        "lockedFromStatus": statement.get("lockedFromStatus", ""),
        **({"sheetUpdatedAt": statement["sheetUpdatedAt"]} if statement.get("sheetUpdatedAt") else {}),
        **timestamps,
    }
    if statement.get("signedStatementReturned") is not None:
        workflow_payload["signedStatementReturned"] = bool(statement.get("signedStatementReturned"))
        workflow_payload["signedStatementNote"] = statement.get("signedStatementNote", "")
        workflow_payload["reimbursementFormReturned"] = bool(statement.get("reimbursementFormReturned"))
        workflow_payload["reimbursementFormNote"] = statement.get("reimbursementFormNote", "")
        workflow_payload["reimbursementFormNos"] = list(statement.get("reimbursementFormNos") or [])
        workflow_payload["reimbursementForms"] = list(statement.get("reimbursementForms") or [])
        workflow_payload["receivedAmount"] = statement.get("receivedAmount", 0)
        workflow_payload["attachments"] = list(statement.get("attachments") or [])
        workflow_payload["registeredBy"] = statement.get("registeredBy", {})
    return workflow_payload


def build_workflow_event_payload(
    event_id, workflow_id, version_id, event_type, from_status, to_status, actor, at, channel, note
):
    return {
        "id": event_id,
        "workflowId": workflow_id,
        "versionId": version_id,
        "eventType": event_type,
        "fromStatus": from_status,
        "toStatus": to_status,
        "actor": {
            "id": actor.get("id", ""),
            "username": actor.get("username", ""),
            "displayName": actor.get("displayName", ""),
        },
        "channel": channel,
        "note": note,
        "at": at,
    }
