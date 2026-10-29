"""Read-only HTTP access to archived checks; authorization precedes DB access."""

from urllib.parse import parse_qs, unquote, urlparse

from server_app.db import connect_db
from server_app.domains.data_quality import read_service as service
from server_app.domains.data_quality.read_repository import ArchiveIntegrityError


def handle(handler, method, path):
    if not path.startswith("/api/data-quality/"):
        return False
    actor = handler.require_user()
    if not actor:
        return True
    try:
        service.authorize(actor)
        parts = [unquote(part) for part in path.removeprefix("/api/data-quality/").split("/")]
        params = {key: values[0] for key, values in parse_qs(urlparse(handler.path).query).items()}
        with connect_db() as conn:
            conn.execute("PRAGMA query_only=ON")
            if method == "GET" and parts == ["scans"]:
                payload = service.list_scans(conn, actor, params)
            elif method == "GET" and parts == ["latest", "issues"]:
                payload = service.list_latest_issues(conn, actor, params)
            elif method == "GET" and len(parts) == 3 and parts[0] == "scans" and parts[2] == "issues":
                payload = service.list_issues(conn, actor, parts[1], params)
            elif method == "GET" and len(parts) == 4 and parts[0] == "scans" and parts[2] == "issues":
                payload = service.get_issue(conn, actor, parts[1], parts[3])
            else:
                raise LookupError("数据核查接口不存在")
        handler.send_json(payload)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, 403)
    except ArchiveIntegrityError as exc:
        handler.send_json({"error": str(exc)}, 409)
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, 404)
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, 400)
    return True
