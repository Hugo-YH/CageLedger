from http import HTTPStatus
from urllib.parse import unquote

from server_app.db import connect_db
from server_app.domains.intake.ai_parse import ai_parse_intake_images, ai_parse_intake_message
from server_app.domains.intake.recognition_images import read_image
from server_app.web import JsonResponse
from server_app.web.router import HANDLED


def intake_ai_parse_handler(handler, _params):
    user = handler.current_user()
    if not user:
        return JsonResponse({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
    try:
        body = handler.read_json_body()
        if not isinstance(body, dict) or not isinstance(body.get("roomNames", []), list):
            raise ValueError("预约识别请求格式无效")
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
    try:
        if "images" in body and body["images"] != []:
            parsed, usage, evidence = ai_parse_intake_images(
                str(body.get("rawMessage") or ""), body.get("roomNames") or [], body["images"]
            )
            return JsonResponse({"item": parsed, "usage": usage, "recognition": evidence})
        parsed, usage = ai_parse_intake_message(
            str(body.get("rawMessage") or ""),
            [str(name) for name in (body.get("roomNames") or [])],
        )
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
    return JsonResponse({"item": parsed, "usage": usage})


def intake_recognition_image_handler(handler, params):
    if not handler.current_user():
        return JsonResponse({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
    try:
        with connect_db() as conn:
            body, name, mime = read_image(conn, unquote(params["batchId"]), params["imageId"])
        handler.send_download(body, name, mime)
    except LookupError as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    return HANDLED
