"""Explicit callable ports used by the HTTP application adapters."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class WebApplicationPorts:
    bounded_int: Callable[..., Any]
    delete_quantity_sheet: Callable[..., Any]
    format_http_date: Callable[..., Any]
    generate_billing_statement: Callable[..., Any]
    generate_billing_statement_by_pi: Callable[..., Any]
    generate_quantity_sheet_statement: Callable[..., Any]
    get_current_billing_statement: Callable[..., Any]
    list_billing_workflows_page: Callable[..., Any]
    list_current_billing_statements: Callable[..., Any]
    move_in_placement_task: Callable[..., Any]
    persist_intake_batches_mark_printed: Callable[..., Any]
    persist_intake_receipt_confirmation: Callable[..., Any]
    persist_intake_receipt_confirmations: Callable[..., Any]
    persist_placement_action: Callable[..., Any]
    quantity_sheet_print_items: Callable[..., Any]
    read_billing_occupancies: Callable[..., Any]
    read_bootstrap_state: Callable[..., Any]
    read_iacuc_index: Callable[..., Any]
    read_principal_type_by_pi: Callable[..., Any]
    read_rooms_for_quantity_sheets: Callable[..., Any]
    reassign_placement_task_room: Callable[..., Any]
    reserve_placement_task: Callable[..., Any]
    save_iacuc_index_file: Callable[..., Any]
    save_quantity_sheet: Callable[..., Any]
    write_entity_state: Callable[..., Any]


_APPLICATION_PORTS: WebApplicationPorts | None = None


def configure_application_ports(ports: WebApplicationPorts):
    global _APPLICATION_PORTS
    _APPLICATION_PORTS = ports


def app_ports():
    if _APPLICATION_PORTS is None:
        raise RuntimeError("Web application ports are not configured")
    return _APPLICATION_PORTS
