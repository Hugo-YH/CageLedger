from http import HTTPStatus
from urllib.parse import parse_qs, urlparse

from server_app.pdf import (
    billing_statement_filename,
    build_pdf_zip,
    quantity_sheet_filename,
    render_billing_statement_pdf,
    render_quantity_sheet_pdf,
)


def quantity_sheet_pdf_route(path, unquote):
    prefix = "/api/quantity-sheets/"
    suffix = "/pdf"
    if not path.startswith(prefix) or not path.endswith(suffix):
        return None
    sheet_id = unquote(path[len(prefix) : -len(suffix)])
    return None if "/" in sheet_id or not sheet_id else sheet_id


def download_quantity_sheet_pdf(handler, sheet_id, *, connect_db, get_quantity_sheet, validate_permission):
    user = handler.require_user()
    if not user:
        return
    try:
        with connect_db() as conn:
            sheet = get_quantity_sheet(conn, sheet_id)
            validate_permission(user, sheet)
        handler.send_download(render_quantity_sheet_pdf(sheet), quantity_sheet_filename(sheet), "application/pdf")
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except RuntimeError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.SERVICE_UNAVAILABLE)


def export_quantity_sheet_pdfs(handler, *, connect_db, get_quantity_sheet, validate_permission, clean_text):
    user = handler.require_user()
    if not user:
        return
    try:
        body = handler.read_json_body()
        sheet_ids = body.get("ids")
        if not isinstance(sheet_ids, list) or not sheet_ids:
            raise ValueError("请选择至少一张数量统计表")
        if len(sheet_ids) > 100:
            raise ValueError("单次最多导出 100 张数量统计表")
        with connect_db() as conn:
            sheets = []
            for sheet_id in sheet_ids:
                sheet = get_quantity_sheet(conn, clean_text(sheet_id))
                validate_permission(user, sheet)
                sheets.append(sheet)
        files = [(quantity_sheet_filename(sheet), render_quantity_sheet_pdf(sheet)) for sheet in sheets]
        if len(files) == 1:
            filename, pdf = files[0]
            handler.send_download(pdf, filename, "application/pdf")
            return
        handler.send_download(
            build_pdf_zip(files),
            "实验动物数量统计表 批量导出.zip",
            "application/zip",
        )
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
    except RuntimeError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.SERVICE_UNAVAILABLE)


def download_billing_statement_pdf(handler, *, connect_db, generate_statement, clean_text):
    user = handler.require_user()
    if not user:
        return
    query = parse_qs(urlparse(handler.path).query)
    payload = statement_payload(
        {
            "month": clean_text(query.get("month", [""])[0]),
            "pi": clean_text(query.get("pi", [""])[0]),
            "sourceType": clean_text(query.get("sourceType", ["quantity_sheet"])[0]) or "quantity_sheet",
        }
    )
    _write_billing_statement_pdf(handler, payload, user, connect_db, generate_statement)


def export_billing_statement_pdfs(handler, *, connect_db, generate_statement, clean_text):
    user = handler.require_user()
    if not user:
        return
    try:
        body = handler.read_json_body()
        requested = body.get("items")
        if not isinstance(requested, list) or not requested:
            raise ValueError("请选择至少一个项目负责人结算项")
        if len(requested) > 100:
            raise ValueError("单次最多导出 100 份结算汇总表")
        files = []
        with connect_db() as conn:
            for item in requested:
                if not isinstance(item, dict):
                    raise ValueError("结算导出参数无效")
                payload = statement_payload(
                    {
                        "month": clean_text(item.get("month", "")),
                        "pi": clean_text(item.get("pi", "")),
                        "sourceType": clean_text(item.get("sourceType", "quantity_sheet")) or "quantity_sheet",
                    }
                )
                statement, lines, _ = generate_statement(conn, payload, user)
                files.append((billing_statement_filename(statement), render_billing_statement_pdf(statement, lines)))
        if len(files) == 1:
            filename, pdf = files[0]
            handler.send_download(pdf, filename, "application/pdf")
            return
        handler.send_download(
            build_pdf_zip(files),
            "项目负责人结算汇总表 批量导出.zip",
            "application/zip",
        )
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
    except RuntimeError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.SERVICE_UNAVAILABLE)


def _write_billing_statement_pdf(handler, payload, user, connect_db, generate_statement):
    try:
        with connect_db() as conn:
            statement, lines, _ = generate_statement(conn, payload, user)
        handler.send_download(
            render_billing_statement_pdf(statement, lines),
            billing_statement_filename(statement),
            "application/pdf",
        )
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
    except RuntimeError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.SERVICE_UNAVAILABLE)


def statement_payload(payload):
    return {**payload, "status": "draft", "persist": False}
