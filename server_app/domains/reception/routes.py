from datetime import date
from urllib.parse import parse_qs, urlparse

from server_app.db import connect_db
from server_app.domains.administration.audit import audit_event, write_audit_events
from server_app.shared import new_id
from server_app.shared.concurrency import StaleWriteError, begin_write
from server_app.shared.time import now_iso
from server_app.web.response import JsonResponse

from . import service, workbook


def read(handler, params):
    actor = handler.current_user()
    if not actor:
        return JsonResponse({"error": "请先登录"}, 401)
    handler._actor_id = actor["id"]
    try:
        query = parse_qs(urlparse(handler.path).query)
        with connect_db() as conn:
            conn.execute("PRAGMA query_only=ON")
            conn.execute("BEGIN")
            operation = (
                service.options if urlparse(handler.path).path.endswith("/filter-options") else service.list_records
            )
            return JsonResponse(operation(conn, actor, query))
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, 400)


def prepare(handler, params):
    actor = handler.current_user()
    if not actor:
        return JsonResponse({"error": "请先登录"}, 401)
    handler._actor_id = actor["id"]
    exporting = urlparse(handler.path).path.endswith("/export")
    try:
        body = handler.read_json_body()
        with connect_db() as conn:
            conn.execute("PRAGMA query_only=ON")
            conn.execute("BEGIN")
            document = service.preview(conn, actor, body)
        if not exporting:
            return JsonResponse(document)
        content = workbook.generate(document)
        identity = new_id("reception-export")
        with connect_db() as conn:
            begin_write(conn)
            write_audit_events(
                conn,
                [
                    audit_event(
                        actor,
                        "reception.exported",
                        "reception_register",
                        identity,
                        f"{actor['displayName']} 导出接收登记预填表：{len(document['items'])}个批次、{document['rowCount']}行",
                        [],
                        now_iso(),
                        None,
                        {
                            "batchIds": body["ids"],
                            "batchVersions": body["expectedVersions"],
                            "applicationVersion": document["applicationVersion"],
                            "rowCount": document["rowCount"],
                            "prefill": True,
                        },
                    )
                ],
            )
            conn.commit()
        handler.send_download(content, f"接收登记预填表_{date.today().isoformat()}.xlsx", workbook.MIME)
        return True
    except StaleWriteError as exc:
        return JsonResponse({"error": str(exc)}, 409)
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, 400)
