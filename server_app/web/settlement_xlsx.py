"""项目负责人结算单 Excel 活表导出 HTTP 入口。"""

from http import HTTPStatus

from server_app.domains.billing.settlement_xlsx import build_settlement_workbook
from server_app.pdf.documents import billing_statement_filename
from server_app.pdf.packages import build_pdf_zip


def _xlsx_filename(statement):
    return billing_statement_filename(statement)[:-4] + ".xlsx"


def download_settlement_xlsx(handler, *, connect_db, generate_statement, clean_text):
    user = handler.require_user()
    if not user:
        return
    try:
        body = handler.read_json_body()
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        return
    items = body.get("items") if isinstance(body, dict) else None
    if not isinstance(items, list) or not items:
        handler.send_json({"error": "请选择至少一个结算项"}, HTTPStatus.BAD_REQUEST)
        return
    try:
        with connect_db() as conn:
            entries = []
            for item in items:
                payload = {
                    "month": clean_text(item.get("month", "")),
                    "pi": clean_text(item.get("pi", "")),
                    "sourceType": clean_text(item.get("sourceType", "quantity_sheet")) or "quantity_sheet",
                    "status": "draft",
                    "persist": False,
                }
                statement, lines, _ = generate_statement(conn, payload, user)
                entries.append((statement, lines))
        content = build_settlement_workbook(entries)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        return
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        return
    if len(entries) == 1:
        content = build_settlement_workbook(entries)
        filename = _xlsx_filename(entries[0][0])
    else:
        files = [
            (_xlsx_filename(statement), build_settlement_workbook([(statement, lines)])) for statement, lines in entries
        ]
        content = build_pdf_zip(files)
        filename = "项目负责人结算汇总表 批量导出.zip"
    handler.send_download(
        content,
        filename,
        "application/zip" if len(entries) > 1 else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
