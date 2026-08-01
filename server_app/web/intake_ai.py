from http import HTTPStatus

from server_app.domains.intake.ai_parse import ai_parse_intake_message
from server_app.web import JsonResponse


def intake_ai_parse_handler(handler, _params):
    user = handler.current_user()
    if not user:
        return JsonResponse({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
    try:
        body = handler.read_json_body()
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
    try:
        parsed, usage = ai_parse_intake_message(
            str(body.get("rawMessage") or ""),
            [str(name) for name in (body.get("roomNames") or [])],
        )
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
    return JsonResponse({"item": parsed, "usage": usage})
