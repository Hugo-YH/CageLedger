"""Billing workflow persistence adapters."""

from server_app.domains.workflow.constants import VERSION_STATUS_ACTIVE, WORKFLOW_STATUS_GENERATED
from server_app.domains.workflow.payloads import billing_workflow_business_key
from server_app.repositories.billing import (
    insert_billing_version as insert_billing_version_repository,
)
from server_app.repositories.billing import (
    insert_billing_workflow as insert_billing_workflow_repository,
)
from server_app.repositories.billing import (
    insert_billing_workflow_event as insert_billing_workflow_event_repository,
)
from server_app.repositories.billing import (
    replace_billing_statement_version_lines as replace_billing_statement_version_lines_repository,
)
from server_app.repositories.billing import (
    update_billing_version as update_billing_version_repository,
)
from server_app.repositories.billing import (
    update_billing_workflow as update_billing_workflow_repository,
)
from server_app.shared import as_int


def insert_billing_workflow(conn, payload):
    insert_billing_workflow_repository(
        conn,
        payload,
        payload.get(
            "businessKey",
            billing_workflow_business_key(
                payload.get("scopeType", ""),
                payload.get("scopeKey", ""),
                payload.get("month", ""),
                payload.get("sourceType", ""),
            ),
        ),
        payload.get("workflowStatus", WORKFLOW_STATUS_GENERATED),
        as_int(payload.get("currentVersionNo")) or 0,
    )


def update_billing_workflow(conn, payload):
    update_billing_workflow_repository(
        conn,
        payload,
        payload.get(
            "businessKey",
            billing_workflow_business_key(
                payload.get("scopeType", ""),
                payload.get("scopeKey", ""),
                payload.get("month", ""),
                payload.get("sourceType", ""),
            ),
        ),
        payload.get("workflowStatus", WORKFLOW_STATUS_GENERATED),
        as_int(payload.get("currentVersionNo")) or 0,
    )


def insert_billing_version(conn, payload):
    insert_billing_version_repository(
        conn,
        payload,
        as_int(payload.get("versionNo")) or 1,
        payload.get("versionStatus", VERSION_STATUS_ACTIVE),
        payload.get("workflowStatus", WORKFLOW_STATUS_GENERATED),
    )


def update_billing_version(conn, payload):
    update_billing_version_repository(
        conn,
        payload,
        as_int(payload.get("versionNo")) or 1,
        payload.get("versionStatus", VERSION_STATUS_ACTIVE),
        payload.get("workflowStatus", WORKFLOW_STATUS_GENERATED),
    )


def replace_version_lines(conn, version_id, lines):
    replace_billing_statement_version_lines_repository(conn, version_id, lines)


def insert_billing_workflow_event(conn, payload):
    insert_billing_workflow_event_repository(conn, payload)
