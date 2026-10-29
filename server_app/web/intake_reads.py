from http import HTTPStatus

from server_app.db import connect_db
from server_app.domains.intake.read_service import print_data
from server_app.shared.concurrency import StaleWriteError
from server_app.web import JsonResponse


def intake_print_data_handler(handler, _params):
    actor = handler.current_user()
    if not actor:
        return JsonResponse({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
    try:
        body = handler.read_json_body()
        with connect_db() as conn:
            conn.execute("PRAGMA query_only=ON")
            return JsonResponse(print_data(conn, actor, body))
    except StaleWriteError as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.CONFLICT)
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
    except LookupError as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.NOT_FOUND)
