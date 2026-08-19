#!/usr/bin/env python3
from email.utils import format_datetime

try:
    import openpyxl
except ImportError:
    openpyxl = None

# Explicit compatibility exports consumed by server.py, tests, and maintenance scripts.
from server_app.config import DB_PATH as DB_PATH  # noqa: F401
from server_app.config import (
    IACUC_INDEX_PATH,
    LEGACY_IACUC_INDEX_PATH,
)
from server_app.db import connect_db
from server_app.domains.billing.generation import BillingGenerationPorts
from server_app.domains.billing.generation import (
    generate_billing_statement as generate_billing_statement_command,
)
from server_app.domains.billing.generation import (
    generate_billing_statement_by_pi as generate_billing_statement_by_pi_command,
)
from server_app.domains.billing.generation import (
    generate_quantity_sheet_statement as generate_quantity_sheet_statement_command,
)
from server_app.domains.iacuc.sync import save_principal_identity as save_principal_identity  # noqa: F401
from server_app.domains.iacuc.sync import (  # noqa: F401
    write_experiment_applications as write_experiment_applications,
)
from server_app.domains.intake import (
    cage_card_qr_id_from_batch_card,
)
from server_app.domains.quantity.application import (
    read_principal_type_by_pi,
    read_room_payloads_for_context,
    read_rooms_for_quantity_sheets,
    write_perf_summary,
)
from server_app.domains.quantity.facade import (
    get_quantity_sheet,
    list_quantity_sheets_by_month_iacuc,
    list_quantity_sheets_by_month_pi,
)
from server_app.domains.reimbursement.application import (
    recalculate_reimbursement_accumulations,
    upsert_reimbursement_record_from_statement,
)
from server_app.domains.reimbursement.facade import (
    get_reimbursement_record_by_key,
)
from server_app.domains.reimbursement.projector import (
    ReimbursementProjectorPorts,
    occupancy_detail_context,
    quantity_sheet_detail_context,
)
from server_app.domains.reimbursement.projector import (
    reimbursement_detail_context_from_workflow as reimbursement_detail_context_from_workflow_projector,
)
from server_app.domains.state.audit_diff import (
    validate_state_write_permission as validate_state_write_permission_rule,
)
from server_app.domains.state.commands import write_entity_state as write_entity_state_command
from server_app.domains.state.entity_mutations import (
    delete_entity,
    insert_entity,
    normalize_entity_payload,
    replace_entity,
)
from server_app.domains.state.infrastructure_commands import (
    write_infrastructure_entity as write_infrastructure_entity_state,
)
from server_app.domains.state.intake_commands import (
    IntakeCommandPorts,
)
from server_app.domains.state.intake_commands import (
    persist_intake_batches_mark_printed as persist_intake_batches_mark_printed_command,
)
from server_app.domains.state.intake_commands import (
    persist_intake_receipt_confirmation as persist_intake_receipt_confirmation_command,
)
from server_app.domains.state.intake_commands import (
    persist_intake_receipt_confirmations as persist_intake_receipt_confirmations_command,
)
from server_app.domains.state.intake_commands import (
    write_intake_batch_entity_state as write_intake_batch_entity_state_command,
)
from server_app.domains.state.occupancy_commands import OccupancyCommandPorts, upsert_occupancy_record
from server_app.domains.state.occupancy_commands import (
    write_occupancy_entity_state as write_occupancy_entity_state_command,
)
from server_app.domains.state.persistence import (
    read_applications_by_iacuc,
    read_cached_state,
)
from server_app.domains.state.persistence import read_state as read_state  # noqa: F401
from server_app.domains.state.placement_commands import (
    PlacementCommandPorts,
)
from server_app.domains.state.placement_commands import (
    persist_placement_action as persist_placement_action_command,
)
from server_app.domains.state.placement_commands import (
    write_placement_task_entity_state as write_placement_task_entity_state_command,
)
from server_app.domains.state.query import read_billing_occupancies as read_billing_occupancies_query
from server_app.domains.state.query import (
    read_billing_state_for_occupancies,
)
from server_app.domains.state.query import read_bootstrap_state as read_bootstrap_state_query
from server_app.domains.state.query import read_occupancies_for_billing as read_occupancies_for_billing_query
from server_app.domains.workflow.application import (  # noqa: F401
    record_archived_reimbursement as record_archived_reimbursement,
)
from server_app.domains.workflow.application import (
    save_billing_statement_workflow,
    update_workflow_status,
)
from server_app.domains.workflow.constants import (
    WORKFLOW_STATUS_FINANCE,
)
from server_app.domains.workflow.facade import (  # noqa: F401
    get_billing_workflow_detail as get_billing_workflow_detail,
)
from server_app.domains.workflow.facade import (
    list_billing_workflows_by_month as list_billing_workflows_by_month_facade,
)
from server_app.domains.workflow.facade import (
    list_billing_workflows_page as list_billing_workflows_page_facade,
)
from server_app.repositories.billing import (
    list_billing_statement_lines_for_version as list_billing_statement_lines_for_version_repository,
)
from server_app.repositories.billing import (
    list_current_billing_statements as list_current_billing_statements_repository,
)
from server_app.repositories.iacuc import read_iacuc_index as read_iacuc_index_repository
from server_app.repositories.iacuc import (
    save_iacuc_index_file as save_iacuc_index_file_repository,
)
from server_app.services.intake import confirm_intake_receipt as confirm_intake_receipt_service
from server_app.services.placement import (
    move_in_placement_task as move_in_placement_task_service,
)
from server_app.services.placement import (
    reassign_placement_task_room as reassign_placement_task_room_service,
)
from server_app.services.placement import (
    reserve_placement_task as reserve_placement_task_service,
)
from server_app.shared import as_int, clean_text, new_id, now_iso
from server_app.web.entity_contracts import WRITABLE_ENTITY_ENDPOINTS


def read_bootstrap_state(conn, actor, scope="summary", room_id=""):
    return read_bootstrap_state_query(conn, actor, read_cached_state, scope, room_id)


def read_billing_occupancies(conn, actor, filters):
    return read_billing_occupancies_query(conn, actor, filters, read_applications_by_iacuc)


def read_occupancies_for_billing(conn, month, iacuc="", pi=""):
    return read_occupancies_for_billing_query(conn, month, read_applications_by_iacuc, iacuc, pi)


def write_entity_state(endpoint, method, item_id, payload, actor):
    writers = {
        "occupancies": write_occupancy_entity_state,
        "intakeBatches": write_intake_batch_entity_state,
        "placementTasks": write_placement_task_entity_state,
        "rooms": lambda method, item_id, payload, actor, spec: write_infrastructure_entity_state(
            "rooms", method, item_id, payload, actor, spec
        ),
        "racks": lambda method, item_id, payload, actor, spec: write_infrastructure_entity_state(
            "racks", method, item_id, payload, actor, spec
        ),
        "slots": lambda method, item_id, payload, actor, spec: write_infrastructure_entity_state(
            "slots", method, item_id, payload, actor, spec
        ),
    }
    return write_entity_state_command(endpoint, method, item_id, payload, actor, WRITABLE_ENTITY_ENDPOINTS, writers)


def intake_command_ports():
    return IntakeCommandPorts(
        normalize_entity_payload=normalize_entity_payload,
        insert_entity=insert_entity,
        replace_entity=replace_entity,
        delete_entity=delete_entity,
        confirm_intake_receipt=confirm_intake_receipt,
        write_perf_summary=write_perf_summary,
    )


def write_intake_batch_entity_state(method, item_id, payload, actor, spec):
    return write_intake_batch_entity_state_command(method, item_id, payload, actor, spec, intake_command_ports())


def persist_intake_receipt_confirmation(batch_id, body, actor):
    return persist_intake_receipt_confirmation_command(batch_id, body, actor, intake_command_ports())


def persist_intake_batches_mark_printed(body, actor):
    return persist_intake_batches_mark_printed_command(body, actor, intake_command_ports())


def persist_intake_receipt_confirmations(body, actor):
    return persist_intake_receipt_confirmations_command(body, actor, intake_command_ports())


def placement_command_ports():
    return PlacementCommandPorts(
        normalize_entity_payload=normalize_entity_payload,
        insert_entity=insert_entity,
        replace_entity=replace_entity,
        delete_entity=delete_entity,
        upsert_occupancy_record=upsert_occupancy_record,
        write_perf_summary=write_perf_summary,
    )


def write_placement_task_entity_state(method, item_id, payload, actor, spec):
    return write_placement_task_entity_state_command(method, item_id, payload, actor, spec, placement_command_ports())


def persist_placement_action(task_id, actor, mutator):
    return persist_placement_action_command(task_id, actor, mutator, placement_command_ports())


def occupancy_command_ports():
    return OccupancyCommandPorts(
        normalize_entity_payload=normalize_entity_payload,
        insert_entity=insert_entity,
        replace_entity=replace_entity,
        delete_entity=delete_entity,
        write_perf_summary=write_perf_summary,
    )


def write_occupancy_entity_state(method, item_id, payload, actor, spec):
    return write_occupancy_entity_state_command(method, item_id, payload, actor, spec, occupancy_command_ports())


def intake_service_deps():
    return {
        "as_int": as_int,
        "cage_card_qr_id": cage_card_qr_id_from_batch_card,
        "clean_text": clean_text,
        "new_id": new_id,
        "now_iso": now_iso,
    }


def placement_service_deps():
    return {
        "clean_text": clean_text,
        "new_id": new_id,
        "now_iso": now_iso,
    }


def confirm_intake_receipt(state, batch_id, payload, actor):
    return confirm_intake_receipt_service(state, batch_id, payload, actor, intake_service_deps())


def reserve_placement_task(state, task_id, slot_id, actor):
    return reserve_placement_task_service(state, task_id, slot_id, actor, placement_service_deps())


def move_in_placement_task(state, task_id, actual_move_in_date, actor):
    return move_in_placement_task_service(state, task_id, actual_move_in_date, actor, placement_service_deps())


def reassign_placement_task_room(state, task_id, room_id, actor):
    return reassign_placement_task_room_service(state, task_id, room_id, actor, placement_service_deps())


def validate_state_write_permission(conn, actor, old_state, new_state):
    return validate_state_write_permission_rule(actor, old_state, new_state)


def format_http_date(value):
    return format_datetime(value, usegmt=True)


def read_iacuc_index():
    with connect_db() as conn:
        return read_iacuc_index_repository(conn, IACUC_INDEX_PATH, LEGACY_IACUC_INDEX_PATH)


def save_iacuc_index_file(items):
    save_iacuc_index_file_repository(IACUC_INDEX_PATH, items)


def billing_generation_ports():
    return BillingGenerationPorts(
        get_quantity_sheet=get_quantity_sheet,
        list_quantity_sheets_by_month_iacuc=list_quantity_sheets_by_month_iacuc,
        list_quantity_sheets_by_month_pi=list_quantity_sheets_by_month_pi,
        read_principal_type_by_pi=read_principal_type_by_pi,
        read_rooms_for_quantity_sheets=read_rooms_for_quantity_sheets,
        read_applications_by_iacuc=read_applications_by_iacuc,
        read_occupancies_for_billing=read_occupancies_for_billing,
        read_billing_state_for_occupancies=read_billing_state_for_occupancies,
        save_billing_statement_workflow=save_billing_statement_workflow,
        update_workflow_status=update_workflow_status,
        occupancy_detail_context=occupancy_detail_context,
        quantity_sheet_detail_context=quantity_sheet_detail_context,
        upsert_reimbursement_record_from_statement=upsert_reimbursement_record_from_statement,
        recalculate_reimbursement_accumulations=recalculate_reimbursement_accumulations,
    )


def generate_quantity_sheet_statement(conn, sheet_id, payload, actor):
    return generate_quantity_sheet_statement_command(conn, sheet_id, payload, actor, billing_generation_ports())


def generate_billing_statement(conn, payload, actor):
    return generate_billing_statement_command(conn, payload, actor, billing_generation_ports())


def generate_billing_statement_by_pi(conn, payload, actor):
    return generate_billing_statement_by_pi_command(conn, payload, actor, billing_generation_ports())


def list_billing_workflows_page(conn, filters):
    return list_billing_workflows_page_facade(conn, filters, WORKFLOW_STATUS_FINANCE)


def list_billing_workflows_by_month(conn, month):
    return list_billing_workflows_by_month_facade(conn, month)


def list_billing_statement_lines_for_version(conn, version_id):
    return list_billing_statement_lines_for_version_repository(conn, version_id)


def list_current_billing_statements(conn):
    return list_current_billing_statements_repository(conn)


def reimbursement_projector_ports():
    return ReimbursementProjectorPorts(
        list_billing_statement_lines_for_version=list_billing_statement_lines_for_version,
        list_quantity_sheets_by_month_iacuc=list_quantity_sheets_by_month_iacuc,
        list_quantity_sheets_by_month_pi=list_quantity_sheets_by_month_pi,
        read_room_payloads_for_context=read_room_payloads_for_context,
        read_occupancies_for_billing=read_occupancies_for_billing,
        read_billing_state_for_occupancies=read_billing_state_for_occupancies,
        get_reimbursement_record_by_key=get_reimbursement_record_by_key,
    )


def reimbursement_detail_context_from_workflow(conn, workflow, statement):
    return reimbursement_detail_context_from_workflow_projector(
        conn, workflow, statement, reimbursement_projector_ports()
    )
