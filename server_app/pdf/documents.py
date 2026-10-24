"""Compatibility PDF entry points and document helper exports."""

from server_app.pdf.renderer import PDF_RENDER_PRIORITY_USER, html_to_pdf

from .document_formatting import as_number as as_number
from .document_formatting import clean_filename as clean_filename
from .document_formatting import document_html as document_html
from .document_formatting import document_number_for as document_number_for
from .document_formatting import h as h
from .document_formatting import number_text as number_text
from .document_formatting import number_text_or_blank as number_text_or_blank
from .quantity_document import LEFT_COLUMN_DAYS as LEFT_COLUMN_DAYS
from .quantity_document import fill_quantity_calendar as fill_quantity_calendar
from .quantity_document import format_quantity_change as format_quantity_change
from .quantity_document import quantity_custom_billing_details_markup as quantity_custom_billing_details_markup
from .quantity_document import quantity_day_cells as quantity_day_cells
from .quantity_document import quantity_headers as quantity_headers
from .quantity_document import quantity_page_markup as quantity_page_markup
from .quantity_document import quantity_sheet_filename as quantity_sheet_filename
from .quantity_document import quantity_sheet_html as quantity_sheet_html
from .quantity_document import quantity_sheet_pages as quantity_sheet_pages
from .quantity_document import quantity_styles as quantity_styles
from .quantity_document import sheet_custom_billing_segments as sheet_custom_billing_segments
from .settlement_document import billing_statement_filename as billing_statement_filename
from .settlement_document import billing_statement_html as billing_statement_html
from .settlement_document import settlement_print_overrides as settlement_print_overrides
from .settlement_document import settlement_styles as settlement_styles
from .settlement_document_layout import GROUP_UNITS as GROUP_UNITS
from .settlement_document_layout import PRINT_ROWS as PRINT_ROWS
from .settlement_document_layout import group_cells as group_cells
from .settlement_document_layout import group_field_spans as group_field_spans
from .settlement_document_layout import group_headers as group_headers
from .settlement_document_layout import settlement_page_markup as settlement_page_markup
from .settlement_document_layout import settlement_pages as settlement_pages
from .settlement_document_layout import species_group_headers as species_group_headers
from .settlement_document_model import SPECIES_ORDER as SPECIES_ORDER
from .settlement_document_model import _statement_column_label as _statement_column_label
from .settlement_document_model import breakdown_key as breakdown_key
from .settlement_document_model import display_line_count as display_line_count
from .settlement_document_model import display_total_count as display_total_count
from .settlement_document_model import empty_summary as empty_summary
from .settlement_document_model import statement_columns as statement_columns
from .settlement_document_model import statement_row as statement_row
from .settlement_document_model import statement_unit as statement_unit
from .settlement_document_model import summary_for_column as summary_for_column
from .settlement_document_model import unit_display as unit_display
from .settlement_document_model import unit_label as unit_label


def render_quantity_sheet_pdf(sheet, *, priority=PDF_RENDER_PRIORITY_USER):
    return html_to_pdf(quantity_sheet_html(sheet), priority=priority)


def render_billing_statement_pdf(statement, lines, *, priority=PDF_RENDER_PRIORITY_USER):
    return html_to_pdf(billing_statement_html(statement, lines), priority=priority)
