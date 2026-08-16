"""Legacy reimbursement record migration from billing workflow statements."""

import json

from server_app.domains.quantity.application import read_room_payloads_for_context
from server_app.domains.quantity.facade import (
    list_quantity_sheets_by_month_iacuc,
    list_quantity_sheets_by_month_pi,
)
from server_app.domains.reimbursement.application import (
    recalculate_all_reimbursement_accumulations,
    upsert_reimbursement_record_from_statement,
)
from server_app.domains.reimbursement.projector import (
    ReimbursementProjectorPorts,
    reimbursement_detail_context_from_workflow,
)
from server_app.domains.state.query import read_billing_state_for_occupancies, read_occupancies_for_billing
from server_app.domains.workflow.facade import get_billing_workflow_by_key
from server_app.repositories.billing import list_billing_statement_lines_for_version
from server_app.repositories.payload import read_setting, set_setting
from server_app.shared import now_iso

REIMBURSEMENT_MIGRATION_KEY = "reimbursementRecordMigrationDone"


def _projector_ports():
    return ReimbursementProjectorPorts(
        list_billing_statement_lines_for_version=list_billing_statement_lines_for_version,
        list_quantity_sheets_by_month_iacuc=list_quantity_sheets_by_month_iacuc,
        list_quantity_sheets_by_month_pi=list_quantity_sheets_by_month_pi,
        read_room_payloads_for_context=read_room_payloads_for_context,
        read_occupancies_for_billing=read_occupancies_for_billing,
        read_billing_state_for_occupancies=read_billing_state_for_occupancies,
        get_reimbursement_record_by_key=get_billing_workflow_by_key,
    )


def migrate_reimbursement_record_schema(conn):
    if read_setting(conn, REIMBURSEMENT_MIGRATION_KEY, False):
        return
    rows = conn.execute("SELECT id, payload FROM billing_workflows ORDER BY month, rowid").fetchall()
    for row in rows:
        workflow = json.loads(row["payload"])
        current_version = workflow.get("currentVersion") or {}
        statement = current_version.get("statement") or {}
        if not statement:
            continue
        lines = list_billing_statement_lines_for_version(conn, current_version.get("id", ""))
        detail_context = reimbursement_detail_context_from_workflow(conn, workflow, statement, _projector_ports())
        upsert_reimbursement_record_from_statement(
            conn,
            workflow,
            statement,
            lines,
            detail_context,
            source="workflow" if workflow.get("sourceType") else "imported",
        )
    recalculate_all_reimbursement_accumulations(conn)
    set_setting(conn, REIMBURSEMENT_MIGRATION_KEY, True, now_iso())
