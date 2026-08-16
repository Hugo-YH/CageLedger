#!/usr/bin/env python3

from server_app.composition import (
    format_http_date,
    generate_billing_statement,
    generate_billing_statement_by_pi,
    generate_quantity_sheet_statement,
    list_billing_workflows_page,
    list_current_billing_statements,
    move_in_placement_task,
    persist_intake_batches_mark_printed,
    persist_intake_receipt_confirmation,
    persist_intake_receipt_confirmations,
    persist_placement_action,
    read_billing_occupancies,
    read_bootstrap_state,
    read_iacuc_index,
    reassign_placement_task_room,
    reserve_placement_task,
    save_iacuc_index_file,
    write_entity_state,
    write_intake_batch_entity_state,  # noqa: F401
)

# Explicit compatibility exports consumed by server.py, tests, and maintenance scripts.
from server_app.config import DB_PATH as DB_PATH  # noqa: F401
from server_app.db import connect_db as connect_db  # noqa: F401
from server_app.domains.iacuc.sync import save_principal_identity as save_principal_identity  # noqa: F401
from server_app.domains.iacuc.sync import (  # noqa: F401
    write_experiment_applications as write_experiment_applications,
)
from server_app.domains.quantity.application import (
    bounded_int,
    delete_quantity_sheet,
    get_current_billing_statement,
    quantity_sheet_print_items,
    read_principal_type_by_pi,
    read_rooms_for_quantity_sheets,
    save_quantity_sheet,
)
from server_app.domains.state.entity_rules import empty_state as empty_state  # noqa: F401
from server_app.domains.state.persistence import read_state as read_state  # noqa: F401
from server_app.domains.workflow.application import (  # noqa: F401
    record_archived_reimbursement as record_archived_reimbursement,
)
from server_app.domains.workflow.application import (
    update_workflow_status as update_workflow_status,
)
from server_app.domains.workflow.facade import (  # noqa: F401
    get_billing_workflow_detail as get_billing_workflow_detail,
)
from server_app.persistence.bootstrap import (
    column_label,  # noqa: F401
    initialize_schema,
    slot_id_for_rack,  # noqa: F401
)
from server_app.runtime import configure as configure_runtime
from server_app.runtime import serve
from server_app.shared import now_iso as now_iso  # noqa: F401
from server_app.web.application import CageLedgerHandler
from server_app.web.ports import WebApplicationPorts, configure_application_ports

configure_runtime(initialize_schema)

configure_application_ports(
    WebApplicationPorts(
        bounded_int=bounded_int,
        delete_quantity_sheet=delete_quantity_sheet,
        format_http_date=format_http_date,
        generate_billing_statement=generate_billing_statement,
        generate_billing_statement_by_pi=generate_billing_statement_by_pi,
        generate_quantity_sheet_statement=generate_quantity_sheet_statement,
        get_current_billing_statement=get_current_billing_statement,
        list_billing_workflows_page=list_billing_workflows_page,
        list_current_billing_statements=list_current_billing_statements,
        move_in_placement_task=move_in_placement_task,
        persist_intake_batches_mark_printed=persist_intake_batches_mark_printed,
        persist_intake_receipt_confirmation=persist_intake_receipt_confirmation,
        persist_intake_receipt_confirmations=persist_intake_receipt_confirmations,
        persist_placement_action=persist_placement_action,
        quantity_sheet_print_items=quantity_sheet_print_items,
        read_billing_occupancies=read_billing_occupancies,
        read_bootstrap_state=read_bootstrap_state,
        read_iacuc_index=read_iacuc_index,
        read_principal_type_by_pi=read_principal_type_by_pi,
        read_rooms_for_quantity_sheets=read_rooms_for_quantity_sheets,
        reassign_placement_task_room=reassign_placement_task_room,
        reserve_placement_task=reserve_placement_task,
        save_iacuc_index_file=save_iacuc_index_file,
        save_quantity_sheet=save_quantity_sheet,
        write_entity_state=write_entity_state,
    )
)


def main():
    serve(CageLedgerHandler)


if __name__ == "__main__":
    main()
