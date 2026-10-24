"""Settlement HTML orchestration, title and print styles."""

from server_app.pdf.formatting import month_label
from server_app.pdf.settlement_notes import settlement_note_markup

from .document_formatting import as_number, clean_filename, document_html
from .settlement_document_layout import settlement_page_markup, settlement_pages
from .settlement_document_model import (
    display_total_count,
    statement_columns,
    statement_row,
    statement_unit,
    summary_for_column,
)


def billing_statement_filename(statement):
    if statement.get("sourceType") == "pi_merged_technical_service":
        return f"{clean_filename(statement.get('pi'))}技术服务费结算单 {month_label(statement.get('month'))}.pdf"
    return f"{clean_filename(statement.get('pi') or '未命名课题组')}课题组实验动物饲养费核算汇总表 {month_label(statement.get('month'))}.pdf"


def billing_statement_html(statement, lines):
    if statement.get("sourceType") == "pi_merged_technical_service":
        from server_app.pdf.technical_services import technical_service_markup, technical_service_styles

        return document_html(
            "实验动物技术服务费结算单", technical_service_styles(), technical_service_markup(statement)
        )
    kept_lines = [
        line
        for line in lines
        if as_number(line.get("animalCount"))
        or as_number(line.get("cageCount"))
        or as_number(line.get("amount"))
        or line.get("quantitySheetRowIds")
    ]
    unit = statement_unit(statement, kept_lines)
    columns = statement_columns(statement, kept_lines)
    modeled = [statement_row(line, columns, unit) for line in kept_lines]
    summaries = {column["key"]: summary_for_column(column["key"], modeled) for column in columns}
    mouse_column_keys = [column["key"] for column in columns if column["species"] == "小鼠"]
    for column in columns:
        summary = summaries[column["key"]]
        column["showFree"] = column["species"] == "小鼠" and summary["free"] > 0
        column["showTiered"] = column["species"] == "小鼠" and summary["tier"] > 0
        column["needsWideAmount"] = as_number(summary["amount"]) >= 100
    pages = settlement_pages(columns)
    total_count = display_total_count(statement, unit, summaries.values())
    total_free = as_number(statement.get("totalFreeCageDays"))
    total_tier = as_number(statement.get("totalTier2CageDays"))
    total_payable = sum(summary["amount"] for summary in summaries.values())
    note_markup = settlement_note_markup(statement, columns, lines)
    result = []
    for index, page in enumerate(pages):
        result.append(
            settlement_page_markup(
                statement,
                modeled,
                page,
                summaries,
                mouse_column_keys,
                unit,
                total_count,
                total_free,
                total_tier,
                total_payable,
                index,
                len(pages),
                note_markup,
            )
        )
    return document_html(
        billing_statement_filename(statement).removesuffix(".pdf"),
        settlement_styles() + settlement_print_overrides(),
        "".join(result),
    )


def settlement_styles():
    return """@page{size:A4;margin:10mm}*{box-sizing:border-box}body{color:#111;font-family:"Arial","Helvetica Neue","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:8.4px;line-height:1.2;margin:0;background:#fff}.document{max-width:190mm;margin:0 auto}.document-page-break{page-break-after:always;break-after:page}.header{border:1px solid #000;padding:6px 8px}.header-grid{display:block}.header-main{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}h1{font-size:15px;line-height:1.1;margin:0 0 4px;display:flex;align-items:flex-end;justify-content:center;gap:8px;flex-wrap:wrap}.meta{display:grid;grid-template-columns:repeat(3,max-content);justify-content:center;gap:2px 10px;margin-top:4px}.meta-table,.summary-table,.sign-table,.custom-billing-table{border-collapse:collapse;width:100%;table-layout:fixed;margin-top:6px}.meta-table td,.summary-table th,.summary-table td,.sign-table td,.custom-billing-table th,.custom-billing-table td{border:1px solid #000;padding:3px 4px;vertical-align:middle}.meta-table td{text-align:left}.summary-table th,.summary-table td,.custom-billing-table th,.custom-billing-table td{text-align:center}.summary-table td:first-child,.summary-table .row-label,.summary-table .meta-summary,.sign-table td{text-align:left}.summary-table .date-column{text-align:center;white-space:nowrap;width:16mm;min-width:16mm;max-width:16mm}.summary-table td:first-child{white-space:nowrap;width:16mm;min-width:16mm;max-width:16mm}.summary-table th{line-height:1.15}.summary-table thead th{white-space:nowrap;text-align:center;vertical-align:middle}.summary-table thead tr:nth-child(3) th{font-size:7.5px;line-height:1.05;padding:2px 1px}.summary-table tbody td{height:7mm}.summary-table tfoot td{font-weight:700}.summary-table .row-label-summary{line-height:1.3;white-space:normal}.summary-table .summary-total-money{vertical-align:middle;text-align:center}.summary-table .meta-summary{line-height:1.35;padding-top:5px;padding-bottom:5px;white-space:normal}.summary-table .meta-summary span{display:block}.summary-table .meta-summary-empty{background:#fff}.summary-table .col-date{width:8.4%;min-width:8.4%;max-width:8.4%}.summary-table .col-group{width:1.526667%}.summary-table .column-empty{color:transparent}.summary-table .group-empty-cell{background:#fff}.note-line{border:1px solid #000;border-top:0;min-height:30px;padding:5px 6px}.sign-table td{height:12mm;vertical-align:top;padding-top:4px}.page-footer{margin-top:4px;text-align:center;font-size:9px;font-weight:700}.custom-billing-details{padding-top:10mm;break-inside:avoid;page-break-inside:avoid}.custom-billing-details h1{justify-content:flex-start}.custom-billing-details p{margin:4px 0}.custom-billing-table th{background:#f1f5f4}.custom-billing-table td{height:8mm;word-break:break-word}.num,.money{font-variant-numeric:tabular-nums}.money{white-space:nowrap}@media print{body{font-size:8px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.meta-table td,.summary-table th,.summary-table td,.sign-table td,.custom-billing-table th,.custom-billing-table td{padding:2px 3px}.summary-table thead tr:nth-child(3) th{font-size:7.1px;padding:1px 1px}.summary-table tbody td{height:6mm}.summary-table .meta-summary{padding-top:4px;padding-bottom:4px}}"""


def settlement_print_overrides():
    return """.summary-table .summary-total-money{font-weight:800}.note-line .note-entry{line-height:1.35}.note-line .note-entry strong{font-weight:700}.note-line .note-detail{margin-left:0}@media print{.summary-table{border-right:1px solid #000;border-spacing:0}.summary-table tr>:last-child{border-right:1px solid #000}.summary-table thead tr:nth-child(3) th{height:6.5mm;line-height:1.15;padding:1px}}"""
