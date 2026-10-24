"""Workflow/version/event projections preserving legacy payload shapes."""

import json


def reimbursement_required(total_amount):
    return float(total_amount or 0) > 0


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
        "manager": row["manager"] or "",
        "totalAmount": row["total_amount"] or 0,
        "reimbursementRequired": reimbursement_required(row["total_amount"]),
        "totalCageDays": row["total_cage_days"] or 0,
        "generatedAt": row["generated_at"] or "",
        "sentAt": row["sent_at"] or "",
        "sentBy": json.loads(row["sent_by"]) if row["sent_by"] else {},
        "sheetUpdatedAt": row["sheet_updated_at"] or "",
        "signedReturnedAt": row["signed_returned_at"] or "",
        "submittedToFinanceAt": row["submitted_to_finance_at"] or "",
        "registeredAt": row["registered_at"] or "",
        "archivedAt": row["archived_at"] or "",
        "lockedFromStatus": row["locked_from_status"] or "",
        "receivedAmount": row["received_amount"] or 0,
        "reimbursementFormNos": _load_json_array(row["reimbursement_form_nos_json"]),
        "reimbursementForms": _load_json_array(row["reimbursement_forms_json"]),
        "signedStatementReturned": bool(row["signed_statement_returned"]),
        "signedStatementNote": row["signed_statement_note"] or "",
        "reimbursementFormReturned": bool(row["reimbursement_form_returned"]),
        "reimbursementFormNote": row["reimbursement_form_note"] or "",
        "registeredBy": json.loads(row["registered_by_json"]) if row["registered_by_json"] else {},
        "attachments": _load_json_array(row["attachments_json"]),
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
        "reimbursementRequired": reimbursement_required(workflow.get("totalAmount")),
        "totalCageDays": workflow.get("totalCageDays", 0),
        "generatedAt": workflow.get("generatedAt", ""),
        "sentAt": workflow.get("sentAt", ""),
        "sentBy": workflow.get("sentBy", {}),
        "sheetUpdatedAt": workflow.get("sheetUpdatedAt", ""),
        "signedReturnedAt": workflow.get("signedReturnedAt", ""),
        "submittedToFinanceAt": workflow.get("submittedToFinanceAt", ""),
        "registeredAt": workflow.get("registeredAt", ""),
        "archivedAt": workflow.get("archivedAt", ""),
        "lockedFromStatus": workflow.get("lockedFromStatus", ""),
        "receivedAmount": workflow.get("receivedAmount", 0),
        "reimbursementFormNos": workflow.get("reimbursementFormNos", []),
        "reimbursementForms": workflow.get("reimbursementForms", []),
        "signedStatementReturned": bool(workflow.get("signedStatementReturned")),
        "signedStatementNote": workflow.get("signedStatementNote", ""),
        "reimbursementFormReturned": bool(workflow.get("reimbursementFormReturned")),
        "reimbursementFormNote": workflow.get("reimbursementFormNote", ""),
        "registeredBy": workflow.get("registeredBy", {}),
        "attachments": workflow.get("attachments", []),
    }


def billing_workflow_detail_row(row):
    return {
        **billing_workflow_list_row(row),
        "currentVersion": billing_workflow_version_row(row, prefix="cv_") if row["cv_id"] else {},
    }


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
        "signedStatementNote": event.get("signedStatementNote", ""),
        "reimbursementFormNote": event.get("reimbursementFormNote", ""),
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
        "signedStatementNote": row["signed_statement_note"] or "",
        "reimbursementFormNote": row["reimbursement_form_note"] or "",
    }


def _load_json_array(value):
    try:
        parsed = json.loads(value) if value else []
    except (TypeError, json.JSONDecodeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _load_json_object(value):
    try:
        parsed = json.loads(value) if value else {}
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}
