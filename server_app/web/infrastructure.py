"""Infrastructure projections and the room layout endpoint."""

from http import HTTPStatus
from urllib.parse import parse_qs, unquote, urlparse

from server_app.db import connect_db
from server_app.domains.infrastructure import service
from server_app.shared.concurrency import StaleWriteError


def handle(handler, method, path):
    parts = path.removeprefix("/api/infrastructure/").split("/")
    if method == "PUT":
        if not (len(parts) == 3 and parts[0] == "rooms" and parts[2] == "rack-layout"):
            return False
        room_id = unquote(parts[1])
        if not room_id or "/" in room_id:
            return False
    elif (
        parts != ["structure"]
        and not (len(parts) == 2 and parts[0] == "rooms")
        and not (len(parts) == 3 and parts[0] == "racks" and parts[2] == "slots")
    ):
        return False
    actor = handler.require_user()
    if not actor:
        return True
    try:
        body = handler.read_json_body() if method == "PUT" else None
        with connect_db() as conn:
            if method == "PUT":
                result = service.save_rack_layout(conn, actor, room_id, body)
            elif parts == ["structure"]:
                result = service.structure(conn, actor)
            elif parts[0] == "rooms":
                view = parse_qs(urlparse(getattr(handler, "path", path)).query).get("view", [""])[0]
                result = service.room_workspace(conn, actor, unquote(parts[1]), view=view)
            else:
                result = service.rack_slots(conn, actor, unquote(parts[1]))
        handler.send_json(result)
    except StaleWriteError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.CONFLICT)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    except ValueError as exc:
        if method != "PUT":
            raise
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
    return True
