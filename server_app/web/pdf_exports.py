from http import HTTPStatus
from urllib.parse import parse_qs, urlparse

from server_app.pdf import (
    billing_statement_filename,
    build_pdf_zip,
    quantity_sheet_filename,
    render_billing_statement_pdf,
    render_quantity_sheet_pdf,
)
from server_app.pdf.cache import pdf_export_cache

PDF_CACHE_ACTOR = {"id": "system-pdf-cache", "role": "admin", "displayName": "系统 PDF 缓存"}


def quantity_sheet_pdf_route(path, unquote):
    prefix = "/api/quantity-sheets/"
    suffix = "/pdf"
    if not path.startswith(prefix) or not path.endswith(suffix):
        return None
    sheet_id = unquote(path[len(prefix) : -len(suffix)])
    return None if "/" in sheet_id or not sheet_id else sheet_id


def pdf_export_job_route(path):
    prefix = "/api/pdf-export-jobs/"
    suffix = "/download"
    if not path.startswith(prefix):
        return None, False
    value = path[len(prefix) :]
    if value.endswith(suffix):
        return value[: -len(suffix)], True
    return value, False


def quantity_pdf_cache_key(sheet):
    return f"quantity-sheet:{sheet.get('id', '')}"


def billing_pdf_cache_key(month, pi, source_type="quantity_sheet"):
    return f"billing-statement:{source_type}:{month}:{pi}"


def invalidate_pdf_cache_for_sheets(sheets):
    keys = []
    for sheet in sheets:
        if not sheet:
            continue
        sheet_id = str(sheet.get("id") or "")
        if sheet_id:
            keys.append(quantity_pdf_cache_key(sheet))
        month = str(sheet.get("month") or "")
        pi = str(sheet.get("pi") or "")
        if month and pi:
            keys.append(billing_pdf_cache_key(month, pi))
    pdf_export_cache.invalidate(keys)


def invalidate_all_pdf_cache():
    pdf_export_cache.invalidate_all()


def schedule_pdf_cache_refresh(sheets, *, connect_db, generate_statement, billing_scopes=()):
    """Warm only documents affected by a quantity-sheet write."""
    unique_sheets = {str(sheet.get("id")): sheet for sheet in sheets if sheet and sheet.get("id")}
    for sheet in unique_sheets.values():
        _enqueue_quantity_pdf(sheet, PDF_CACHE_ACTOR["id"])
    billing_scopes = set(billing_scopes) | {
        (str(sheet.get("month") or ""), str(sheet.get("pi") or ""))
        for sheet in unique_sheets.values()
        if sheet.get("month") and sheet.get("pi")
    }
    for month, pi in billing_scopes:
        _enqueue_billing_pdf(
            month,
            pi,
            PDF_CACHE_ACTOR["id"],
            connect_db=connect_db,
            generate_statement=generate_statement,
            actor=PDF_CACHE_ACTOR,
        )


def download_quantity_sheet_pdf(handler, sheet_id, *, connect_db, get_quantity_sheet, validate_permission):
    user = handler.require_user()
    if not user:
        return
    try:
        with connect_db() as conn:
            sheet = get_quantity_sheet(conn, sheet_id)
            validate_permission(user, sheet)
        body = _render_quantity_pdf(sheet)
        handler.send_download(body, quantity_sheet_filename(sheet), "application/pdf")
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except RuntimeError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.SERVICE_UNAVAILABLE)


def download_billing_statement_pdf(
    handler, *, connect_db, list_quantity_sheets_by_month_pi, validate_permission, generate_statement, clean_text
):
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
    try:
        with connect_db() as conn:
            sheets = list_quantity_sheets_by_month_pi(conn, payload["month"], payload["pi"])
            if not sheets:
                raise ValueError("未找到该 PI 在结算月份内的数量统计表")
            for sheet in sheets:
                validate_permission(user, sheet)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        return
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        return
    _write_billing_statement_pdf(handler, payload, user, connect_db, generate_statement)


def start_pdf_export(
    handler,
    *,
    connect_db,
    get_quantity_sheet,
    list_quantity_sheets_by_month_pi,
    validate_permission,
    generate_statement,
    clean_text,
):
    user = handler.require_user()
    if not user:
        return
    try:
        body = handler.read_json_body()
        _start_pdf_export_from_body(
            handler,
            body,
            user,
            connect_db=connect_db,
            get_quantity_sheet=get_quantity_sheet,
            list_quantity_sheets_by_month_pi=list_quantity_sheets_by_month_pi,
            validate_permission=validate_permission,
            generate_statement=generate_statement,
            clean_text=clean_text,
        )
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)


def _start_pdf_export_from_body(
    handler,
    body,
    user,
    *,
    connect_db,
    get_quantity_sheet,
    list_quantity_sheets_by_month_pi,
    validate_permission,
    generate_statement,
    clean_text,
):
    try:
        kind = clean_text(body.get("kind"))
        if kind == "quantity_sheet":
            job = _start_quantity_export(
                body.get("ids"), user, connect_db, get_quantity_sheet, validate_permission, clean_text
            )
        elif kind == "billing_statement":
            job = _start_billing_export(
                body.get("items"),
                user,
                connect_db,
                list_quantity_sheets_by_month_pi,
                validate_permission,
                generate_statement,
                clean_text,
            )
        else:
            raise ValueError("PDF 导出类型无效")
        status = HTTPStatus.OK if job.status == "ready" else HTTPStatus.ACCEPTED
        handler.send_json(pdf_export_cache.job_payload(job), status)
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)


def read_pdf_export_job(handler, job_id):
    user = handler.require_user()
    if not user:
        return
    try:
        handler.send_json(pdf_export_cache.job_payload(pdf_export_cache.get_job(job_id, user)))
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)


def download_pdf_export_job(handler, job_id):
    user = handler.require_user()
    if not user:
        return
    try:
        job = pdf_export_cache.get_job(job_id, user)
        handler.send_download(pdf_export_cache.read_job(job), job.filename, job.content_type)
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.CONFLICT)


def export_quantity_sheet_pdfs(handler, **kwargs):
    """Compatibility endpoint for earlier clients."""
    user = handler.require_user()
    if not user:
        return
    try:
        body = handler.read_json_body()
        sheets = _read_quantity_sheets(
            body.get("ids"),
            user,
            kwargs["connect_db"],
            kwargs["get_quantity_sheet"],
            kwargs["validate_permission"],
            kwargs["clean_text"],
        )
        files = [(quantity_sheet_filename(sheet), _render_quantity_pdf(sheet)) for sheet in sheets]
        if len(files) == 1:
            handler.send_download(files[0][1], files[0][0], "application/pdf")
            return
        handler.send_download(build_pdf_zip(files), "实验动物数量统计表 批量导出.zip", "application/zip")
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)


def export_billing_statement_pdfs(handler, **kwargs):
    """Compatibility endpoint for earlier clients."""
    user = handler.require_user()
    if not user:
        return
    try:
        body = handler.read_json_body()
        items = _read_billing_items(
            body.get("items"),
            user,
            kwargs["connect_db"],
            kwargs["list_quantity_sheets_by_month_pi"],
            kwargs["validate_permission"],
            kwargs["clean_text"],
        )
        files = [
            (
                billing_statement_filename(payload),
                _render_billing_pdf(
                    payload,
                    connect_db=kwargs["connect_db"],
                    generate_statement=kwargs["generate_statement"],
                    actor=user,
                ),
            )
            for payload in items
        ]
        if len(files) == 1:
            handler.send_download(files[0][1], files[0][0], "application/pdf")
            return
        handler.send_download(build_pdf_zip(files), "项目负责人结算汇总表 批量导出.zip", "application/zip")
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)


def _start_quantity_export(sheet_ids, user, connect_db, get_quantity_sheet, validate_permission, clean_text):
    sheets = _read_quantity_sheets(sheet_ids, user, connect_db, get_quantity_sheet, validate_permission, clean_text)
    if len(sheets) == 1:
        return _enqueue_quantity_pdf(sheets[0], user["id"])

    def render(progress):
        files = []
        for index, sheet in enumerate(sheets, start=1):
            files.append((quantity_sheet_filename(sheet), _render_quantity_pdf(sheet)))
            progress(index)
        return build_pdf_zip(files)

    return pdf_export_cache.enqueue_batch(
        owner_id=user["id"], filename="实验动物数量统计表 批量导出.zip", total=len(sheets), render=render
    )


def _start_billing_export(
    requested,
    user,
    connect_db,
    list_quantity_sheets_by_month_pi,
    validate_permission,
    generate_statement,
    clean_text,
):
    items = _read_billing_items(
        requested, user, connect_db, list_quantity_sheets_by_month_pi, validate_permission, clean_text
    )
    if len(items) == 1:
        payload = items[0]
        return _enqueue_billing_pdf(
            payload["month"],
            payload["pi"],
            user["id"],
            connect_db=connect_db,
            generate_statement=generate_statement,
            actor=user,
        )

    def render(progress):
        files = []
        for index, payload in enumerate(items, start=1):
            files.append(
                (
                    billing_statement_filename(payload),
                    _render_billing_pdf(
                        payload, connect_db=connect_db, generate_statement=generate_statement, actor=user
                    ),
                )
            )
            progress(index)
        return build_pdf_zip(files)

    return pdf_export_cache.enqueue_batch(
        owner_id=user["id"], filename="项目负责人结算汇总表 批量导出.zip", total=len(items), render=render
    )


def _read_quantity_sheets(sheet_ids, user, connect_db, get_quantity_sheet, validate_permission, clean_text):
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
    return sheets


def _read_billing_items(requested, user, connect_db, list_sheets, validate_permission, clean_text):
    if not isinstance(requested, list) or not requested:
        raise ValueError("请选择至少一个项目负责人结算项")
    if len(requested) > 100:
        raise ValueError("单次最多导出 100 份结算汇总表")
    items = []
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
            if payload["sourceType"] != "quantity_sheet":
                raise ValueError("当前仅支持数量统计表来源的结算导出")
            sheets = list_sheets(conn, payload["month"], payload["pi"])
            if not sheets:
                raise ValueError("未找到该 PI 在结算月份内的数量统计表")
            for sheet in sheets:
                validate_permission(user, sheet)
            items.append(payload)
    return items


def _enqueue_quantity_pdf(sheet, owner_id):
    return pdf_export_cache.enqueue_artifact(
        owner_id=owner_id,
        key=quantity_pdf_cache_key(sheet),
        filename=quantity_sheet_filename(sheet),
        content_type="application/pdf",
        render=lambda: render_quantity_sheet_pdf(sheet),
    )


def _enqueue_billing_pdf(month, pi, owner_id, *, connect_db, generate_statement, actor):
    payload = statement_payload({"month": month, "pi": pi, "sourceType": "quantity_sheet"})
    return pdf_export_cache.enqueue_artifact(
        owner_id=owner_id,
        key=billing_pdf_cache_key(month, pi),
        filename=billing_statement_filename(payload),
        content_type="application/pdf",
        render=lambda: _render_billing_pdf(
            payload, connect_db=connect_db, generate_statement=generate_statement, actor=actor
        ),
    )


def _render_quantity_pdf(sheet):
    return pdf_export_cache.render_cached(quantity_pdf_cache_key(sheet), lambda: render_quantity_sheet_pdf(sheet))


def _render_billing_pdf(payload, *, connect_db, generate_statement, actor):
    key = billing_pdf_cache_key(payload["month"], payload["pi"], payload["sourceType"])

    def render():
        with connect_db() as conn:
            statement, lines, _ = generate_statement(conn, payload, actor)
        return render_billing_statement_pdf(statement, lines)

    return pdf_export_cache.render_cached(key, render)


def _write_billing_statement_pdf(handler, payload, user, connect_db, generate_statement):
    try:
        handler.send_download(
            _render_billing_pdf(payload, connect_db=connect_db, generate_statement=generate_statement, actor=user),
            billing_statement_filename(payload),
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
