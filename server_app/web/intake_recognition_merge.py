"""HTTP adapter for read-only appointment recognition comparison."""

from http import HTTPStatus

from server_app.db import connect_db
from server_app.domains.intake.recognition_merge import recognition_preview
from server_app.web import JsonResponse


def intake_recognition_preview_handler(handler, _params):
    actor = handler.current_user()
    if not actor:
        return JsonResponse({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
    try:
        body = handler.read_json_body()
        with connect_db() as conn:
            conn.execute("PRAGMA query_only=ON")
            conn.execute("BEGIN")
            return JsonResponse(recognition_preview(conn, actor, body))
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
