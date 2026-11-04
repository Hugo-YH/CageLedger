"""Authenticated contacts and admin-only upload/maintenance boundary."""

import sqlite3
from urllib.parse import parse_qs, unquote, urlparse

from server_app.db import connect_db
from server_app.domains.researchers import contacts, repository, service
from server_app.shared.concurrency import StaleWriteError


def handle(handler, method, path):
    if path != "/api/researchers" and not path.startswith("/api/researchers/"):
        return False
    actor = handler.require_user()
    if not actor:
        return True
    try:
        contact_read = method == "POST" and path == "/api/researchers/contacts/resolve"
        service.authorize(actor, write=method != "GET" and not contact_read)
        body = handler.read_json_body() if method != "GET" else None
        prepared = (
            service.prepare(body)
            if method == "POST" and path in ("/api/researchers/import/preview", "/api/researchers/import")
            else None
        )
        with connect_db() as conn:
            if method == "GET" and path == "/api/researchers":
                params = {key: values[0] for key, values in parse_qs(urlparse(handler.path).query).items()}
                payload = repository.list_items(conn, params)
            elif contact_read:
                payload = contacts.resolve(conn, actor, body)
            elif method == "POST" and path == "/api/researchers/import/preview":
                payload = service.preview(conn, actor, prepared)
            elif method == "POST" and path == "/api/researchers/import":
                payload = service.confirm(conn, actor, body, prepared)
            elif len(path.split("/")) == 4 and path.startswith("/api/researchers/"):
                researcher_id = unquote(path.rsplit("/", 1)[1])
                if method == "GET":
                    payload = {"item": repository.get(conn, researcher_id)}
                elif method == "PUT":
                    payload = service.update(conn, actor, researcher_id, body)
                else:
                    raise LookupError("实验人员接口不存在")
            else:
                raise LookupError("实验人员接口不存在")
        handler.send_json(payload)
    except StaleWriteError as exc:
        handler.send_json({"error": str(exc)}, 409)
    except sqlite3.IntegrityError:
        handler.send_json({"error": "通讯录账号已存在，请重新预览或刷新资料"}, 409)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, 403)
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, 404)
    except (ValueError, TypeError, KeyError) as exc:
        handler.send_json({"error": str(exc) or "实验人员资料无效"}, 400)
    return True
