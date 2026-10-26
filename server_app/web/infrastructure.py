"""Infrastructure read endpoints; existing write and bootstrap contracts stay separate."""

from http import HTTPStatus
from urllib.parse import unquote

from server_app.db import connect_db
from server_app.domains.infrastructure import service


def handle(handler, path):
    parts = path.removeprefix("/api/infrastructure/").split("/")
    if (
        parts != ["structure"]
        and not (len(parts) == 2 and parts[0] == "rooms")
        and not (len(parts) == 3 and parts[0] == "racks" and parts[2] == "slots")
    ):
        return False
    actor = handler.require_user()
    if not actor:
        return True
    try:
        with connect_db() as conn:
            if parts == ["structure"]:
                result = service.structure(conn, actor)
            elif parts[0] == "rooms":
                result = service.room_workspace(conn, actor, unquote(parts[1]))
            else:
                result = service.rack_slots(conn, actor, unquote(parts[1]))
            handler.send_json(result)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    return True
