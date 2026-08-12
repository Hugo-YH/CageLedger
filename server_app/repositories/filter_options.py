"""Generic column filter-options endpoint shared by business lists.

The single `/api/filter-options?list=...&column=...` route keeps every list on
the same server-side aggregation pattern: a column whitelist plus GROUP BY,
with counts scoped to the currently applied filters except the column being
configured.
"""

from urllib.parse import parse_qs, urlparse

from server_app.db import connect_db
from server_app.domains.reimbursement_ledger.listing import (
    CLAIM_LIST_COLUMNS,
    LEGACY_LIST_COLUMNS,
    OBLIGATION_LIST_COLUMNS,
    list_column_options,
)
from server_app.repositories.billing_candidates import (
    list_billing_candidate_iacuc_filter_options,
    list_billing_candidate_manager_filter_options,
    list_billing_candidate_scalar_filter_options,
)
from server_app.repositories.billing_workflows import list_billing_workflow_filter_options
from server_app.repositories.entities import list_intake_batch_filter_options
from server_app.repositories.quantity_sheets import list_quantity_sheet_filter_options
from server_app.shared import clean_text


def filtered_where(filter_specs, filters):
    where, params = [], []
    for key, expression in filter_specs:
        value = clean_text(filters.get(key, ""))
        if not value:
            continue
        where.append(expression)
        params.append(value)
    return " AND ".join(where), tuple(params)


def route_column_filter_options(handler, path):
    if path != "/api/filter-options":
        return False
    query = parse_qs(urlparse(handler.path).query)
    list_name = clean_text(query.get("list", [""])[0])
    column = clean_text(query.get("column", [""])[0])
    if not list_name or not column:
        handler.send_json({"error": "缺少 list 或 column 参数"}, 400)
        return True
    if not handler.require_user():
        return True
    filters = handler.list_filters(default_limit=20, max_limit=10000)
    with connect_db() as conn:
        if list_name == "quantity-sheets":
            handler.send_json(list_quantity_sheet_filter_options(conn, filters, filtered_where, column))
        elif list_name == "intake-batches":
            handler.send_json(list_intake_batch_filter_options(conn, filters, filtered_where, column))
        elif list_name == "settlement-candidates":
            if column == "iacuc":
                items = list_billing_candidate_iacuc_filter_options(conn, "quantity_sheet", filters)
            elif column == "manager":
                items = list_billing_candidate_manager_filter_options(conn, "quantity_sheet", filters)
            else:
                items = list_billing_candidate_scalar_filter_options(conn, "quantity_sheet", filters, column)
            handler.send_json({"items": items})
        elif list_name == "billing-workflows":
            handler.send_json({"items": list_billing_workflow_filter_options(conn, filters, column)})
        elif list_name == "reimbursement-obligations":
            handler.send_json(
                list_column_options(
                    conn, "reimbursement_settlement_obligations", OBLIGATION_LIST_COLUMNS, filters, column
                )
            )
        elif list_name == "reimbursement-claims":
            handler.send_json(list_column_options(conn, "reimbursement_claims", CLAIM_LIST_COLUMNS, filters, column))
        elif list_name == "reimbursement-legacy":
            handler.send_json(list_column_options(conn, "reimbursement_records", LEGACY_LIST_COLUMNS, filters, column))
        else:
            handler.send_json({"error": "未知的列表"}, 400)
    return True
