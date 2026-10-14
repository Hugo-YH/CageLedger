"""Authenticated technical-service HTTP boundary."""

import sqlite3
from urllib.parse import parse_qs, urlparse

from server_app.db import connect_db
from server_app.domains.technical_services import repository as repo
from server_app.domains.technical_services import service, settlement
from server_app.pdf.documents import billing_statement_filename, render_billing_statement_pdf
from server_app.shared.concurrency import StaleWriteError


def handle(handler, method, path):
    if not path.startswith("/api/technical-services/"):
        return False
    actor = handler.require_user()
    if not actor:
        return True
    parts = path.removeprefix("/api/technical-services/").split("/")
    params = {key: values[0] for key, values in parse_qs(urlparse(handler.path).query).items()}
    try:
        service.authorize(actor)
        with connect_db() as conn:
            payload = None
            if method == "GET" and parts == ["catalog"]:
                payload = {"items": repo.catalog(conn)}
            elif method == "GET" and parts == ["sheets"]:
                payload = repo.list_sheets(conn, params)
            elif method == "GET" and parts == ["sheets", "filter-options"]:
                payload = repo.sheet_filter_options(conn, params)
            elif method == "GET" and parts == ["settlement-candidates", "filter-options"]:
                payload = repo.candidate_filter_options(conn, params)
            elif method == "GET" and len(parts) == 2 and parts[0] == "sheets":
                payload = {"item": {**repo.get(conn, parts[1])[1], "protected": parts[1] in repo.protected_ids(conn)}}
            elif method == "GET" and parts == ["settlement-candidates"]:
                payload = settlement.candidates(conn, actor, params)
            elif method == "POST" and parts == ["sheets"]:
                payload = service.save(conn, actor, handler.read_json_body())
            elif method == "PUT" and len(parts) == 2 and parts[0] == "sheets":
                payload = service.save(conn, actor, handler.read_json_body(), parts[1])
            elif method == "DELETE" and len(parts) == 2 and parts[0] == "sheets":
                payload = service.delete(conn, actor, parts[1], handler.read_json_body().get("expectedUpdatedAt"))
            elif method == "POST" and parts == ["settlements", "preview"]:
                payload = settlement.preview(conn, actor, handler.read_json_body())
            elif method == "POST" and parts == ["settlements"]:
                payload = settlement.initiate(conn, actor, handler.read_json_body())
            elif method == "POST" and parts == ["settlements", "pdf"]:
                payload = settlement.preview(conn, actor, handler.read_json_body())
                handler.send_download(
                    render_billing_statement_pdf(payload["statement"], payload["lines"]),
                    billing_statement_filename(payload["statement"]),
                    "application/pdf",
                )
                payload = None
            else:
                raise LookupError("技术服务接口不存在")
        if payload is not None:
            handler.send_json(payload)
    except (StaleWriteError, sqlite3.IntegrityError) as exc:
        handler.send_json(
            {"error": str(exc) if isinstance(exc, StaleWriteError) else "该服务明细已存在，请刷新后编辑"}, 409
        )
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, 403)
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, 404)
    except (ValueError, TypeError, KeyError) as exc:
        handler.send_json({"error": str(exc) or "技术服务数据无效"}, 400)
    return True
