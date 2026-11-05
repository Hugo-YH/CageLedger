import hashlib
import json
from http import HTTPStatus
from threading import BoundedSemaphore
from urllib.parse import unquote

from server_app.db import connect_db
from server_app.domains.intake.ai_parse import ai_parse_intake_images, ai_parse_intake_message
from server_app.domains.intake.recognition_images import read_image
from server_app.domains.intake.recognition_jobs import JOBS
from server_app.domains.intake.recognition_uploads import UPLOADS, RecognitionBusy, UploadExpired, request_images
from server_app.web import JsonResponse
from server_app.web.multipart import parse_multipart_files
from server_app.web.router import HANDLED

_UPLOAD_SLOTS = BoundedSemaphore(2)


def intake_recognition_upload_handler(handler, _params):
    user = handler.current_user()
    if not user:
        return JsonResponse({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
    if not _UPLOAD_SLOTS.acquire(blocking=False):
        return JsonResponse({"error": "预约图片上传繁忙，请稍后重试"}, HTTPStatus.SERVICE_UNAVAILABLE)
    try:
        files = parse_multipart_files(handler.headers.get("Content-Type", ""), handler.read_raw_body(), max_files=4)
        return JsonResponse({"items": UPLOADS.add(user["id"], files)}, HTTPStatus.CREATED)
    except RecognitionBusy as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.SERVICE_UNAVAILABLE)
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
    finally:
        _UPLOAD_SLOTS.release()


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

    def recognize():
        if ("images" in body and body["images"] != []) or ("imageRefs" in body and body["imageRefs"] != []):
            images = request_images(body, user["id"])
            parsed, usage, evidence = ai_parse_intake_images(
                str(body.get("rawMessage") or ""), body.get("roomNames") or [], images, decoded=True
            )
            return {"item": parsed, "usage": usage, "recognition": evidence}
        # Validate even empty reference collections rather than silently accepting malformed input.
        if "imageRefs" in body:
            request_images(body, user["id"])
        parsed, usage = ai_parse_intake_message(
            str(body.get("rawMessage") or ""),
            [str(name) for name in (body.get("roomNames") or [])],
        )
        return {"item": parsed, "usage": usage}

    try:
        # Only running requests are merged; an explicit retry after completion always calls AI again.
        key = hashlib.sha256(json.dumps([user["id"], body], sort_keys=True).encode()).hexdigest()
        result = JOBS.run(key, recognize)
    except UploadExpired as exc:
        return JsonResponse({"error": str(exc), "code": "INTAKE_UPLOAD_EXPIRED"}, HTTPStatus.GONE)
    except RecognitionBusy as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.SERVICE_UNAVAILABLE)
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
    return JsonResponse(result)


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
