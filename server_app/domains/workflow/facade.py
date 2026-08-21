"""Compatibility-facing workflow queries backed by the canonical repository."""

from server_app.repositories.billing_statements import list_billing_statement_line_summaries_for_version
from server_app.repositories.billing_workflows import (
    billing_workflow_detail_item,
    delete_billing_workflow_tree,
    get_billing_version,
    get_billing_workflow,
    get_billing_workflow_by_key,
    get_billing_workflow_detail,
    list_billing_workflow_events,
    list_billing_workflow_versions,
    list_billing_workflows,
)
from server_app.repositories.billing_workflows import (
    list_billing_workflows_by_month as list_billing_workflows_by_month_repository,
)
from server_app.repositories.billing_workflows import (
    list_billing_workflows_page as list_page_repository,
)
from server_app.shared import clean_text

from .funding_options import current_funding_book_options


def list_billing_workflows_page(conn, filters, excluded_status):
    return list_page_repository(conn, filters, clean_text, excluded_status)


def list_billing_workflows_by_month(conn, month):
    return list_billing_workflows_by_month_repository(conn, month)


def list_billing_workflow_lines(conn, workflow_id, version_id=""):
    workflow = get_billing_workflow(conn, workflow_id)
    if not workflow:
        raise LookupError("结算流程不存在")
    selected_version_id = clean_text(version_id) or clean_text(workflow.get("currentVersionId", ""))
    if not selected_version_id:
        return {"workflowId": workflow_id, "versionId": "", "lines": []}
    return {
        "workflowId": workflow_id,
        "versionId": selected_version_id,
        "lines": list_billing_statement_line_summaries_for_version(conn, selected_version_id),
    }


def delete_billing_workflow(conn, workflow_id):
    workflow = get_billing_workflow(conn, workflow_id)
    if not workflow:
        raise LookupError("结算流程不存在")
    delete_billing_workflow_tree(conn, workflow_id)
    return workflow


__all__ = [
    "billing_workflow_detail_item",
    "current_funding_book_options",
    "delete_billing_workflow",
    "get_billing_version",
    "get_billing_workflow",
    "get_billing_workflow_by_key",
    "get_billing_workflow_detail",
    "list_billing_workflow_events",
    "list_billing_workflow_lines",
    "list_billing_workflow_versions",
    "list_billing_workflows",
    "list_billing_workflows_by_month",
    "list_billing_workflows_page",
]
