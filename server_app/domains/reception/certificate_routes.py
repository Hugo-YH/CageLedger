"""Authenticated HTTP boundary for certificate evidence and confirmed reception facts."""

import logging
import sqlite3
from urllib.parse import parse_qs, unquote, urlparse

from server_app.db import connect_db
from server_app.runtime_logging import emit_event
from server_app.shared.concurrency import StaleWriteError
from server_app.web.multipart import parse_multipart_upload
from server_app.web.request_body import read_body
from server_app.web.response import JsonResponse

from . import certificate_service, registration_service
from .certificate_files import CertificateUnavailableError


def handle(handler, params):
    actor = handler.current_user()
    if not actor:
        return JsonResponse({"error": "请先登录"}, 401)
    handler._actor_id = actor["id"]
    batch_id = unquote(params["batchId"])
    path = urlparse(handler.path).path
    try:
        certificate_service.authorize(actor, write=handler.command != "GET")
        if handler.command == "GET":
            with connect_db() as conn:
                conn.execute("PRAGMA query_only=ON")
                conn.execute("BEGIN")
                if path.endswith("/registration"):
                    return JsonResponse(certificate_service.detail(conn, actor, batch_id))
                preview = path.endswith("/preview")
                content, name = certificate_service.download(
                    conn, actor, batch_id, params["attachmentId"], preview=preview
                )
            handler.send_download(content, name, "image/png" if preview else "application/pdf")
            return True
        if handler.command == "PUT":
            body = handler.read_json_body()
            with connect_db() as conn:
                result = registration_service.save(conn, actor, batch_id, body)
                conn.commit()
            return JsonResponse(result)
        if path.endswith("/recognize"):
            return JsonResponse(
                certificate_service.recognize(actor, batch_id, params["attachmentId"], handler.read_json_body())
            )
        query = parse_qs(urlparse(handler.path).query)
        expected = query.get("expectedBatchUpdatedAt", [None])[0]
        with connect_db() as conn:
            certificate_service.load_batch(conn, batch_id, expected=expected, writing=True)
        name, content = parse_multipart_upload(
            handler.headers.get("Content-Type", ""), read_body(handler.headers, handler.rfile)
        )
        result = certificate_service.upload(actor, batch_id, expected, name, content)
        return JsonResponse(result, 200 if result["reused"] else 201)
    except PermissionError as exc:
        return JsonResponse({"error": str(exc)}, 403)
    except StaleWriteError as exc:
        return JsonResponse({"error": str(exc)}, 409)
    except LookupError as exc:
        return JsonResponse({"error": str(exc)}, 404)
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, 400)
    except sqlite3.IntegrityError as exc:
        emit_event("reception_write_conflict", level=logging.WARNING, error=exc, component="reception", rate_limit=True)
        return JsonResponse({"error": "接收记录已变化，请刷新后核对"}, 409)
    except (CertificateUnavailableError, OSError, sqlite3.OperationalError) as exc:
        emit_event(
            "reception_certificate_unavailable",
            level=logging.WARNING,
            error=exc,
            component="reception",
            rate_limit=True,
        )
        message = str(exc) if isinstance(exc, CertificateUnavailableError) else "接收登记服务暂不可用，请稍后重试"
        return JsonResponse({"error": message}, 503)
