"""Compatibility-facing quantity sheet queries backed by the canonical repository."""

from server_app.repositories.filter_options import filtered_where
from server_app.repositories.quantity_sheets import (
    get_quantity_sheet as get_quantity_sheet_repository,
)
from server_app.repositories.quantity_sheets import (
    list_quantity_sheet_filter_options as list_filter_options_repository,
)
from server_app.repositories.quantity_sheets import (
    list_quantity_sheets_by_month,
    list_quantity_sheets_by_month_iacuc,
    list_quantity_sheets_by_month_pi,
)
from server_app.repositories.quantity_sheets import (
    list_quantity_sheets_page as list_page_repository,
)


def list_quantity_sheets_page(conn, filters):
    return list_page_repository(conn, filters, filtered_where)


def list_quantity_sheet_filter_options(conn, filters, column):
    return list_filter_options_repository(conn, filters, filtered_where, column)


def get_quantity_sheet(conn, sheet_id):
    row = get_quantity_sheet_repository(conn, sheet_id)
    if not row:
        raise LookupError("数量统计表不存在")
    return row


__all__ = [
    "get_quantity_sheet",
    "list_quantity_sheet_filter_options",
    "list_quantity_sheets_by_month",
    "list_quantity_sheets_by_month_iacuc",
    "list_quantity_sheets_by_month_pi",
    "list_quantity_sheets_page",
]
