"""Authenticated navigation preferences; existing business endpoints are unaffected."""

from server_app.db import connect_db
from server_app.domains.system_features import service
from server_app.shared.concurrency import StaleWriteError


def handle(handler, method, path):
    if path != "/api/system/features":
        return False
    actor = handler.require_user()
    if not actor:
        return True
    try:
        service.authorize(actor, write=method != "GET")
        body = handler.read_json_body() if method == "PUT" else None
        with connect_db() as conn:
            item = service.save(conn, actor, body) if method == "PUT" else service.read(conn, actor)
            conn.commit()
        handler.send_json({"item": item})
    except StaleWriteError as exc:
        handler.send_json({"error": str(exc)}, 409)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, 403)
    except (ValueError, TypeError, KeyError) as exc:
        handler.send_json({"error": str(exc) or "系统功能配置格式无效"}, 400)
    return True
