"""Stable lightweight router registrations used before legacy path matching."""

from http import HTTPStatus

from server_app.config import DB_PATH
from server_app.db import connect_db
from server_app.domains.administration import (
    acknowledge_release_announcement,
    release_announcement_status,
    system_info,
)
from server_app.web.iacuc import iacuc_expiry_handler, iacuc_index_handler
from server_app.web.intake_ai import intake_ai_parse_handler
from server_app.web.intake_strain import intake_strain_standardize_handler
from server_app.web.response import JsonResponse
from server_app.web.router import Router


def current_session_response(handler, params):
    user = handler.current_user()
    if not user:
        return JsonResponse({"user": None}, HTTPStatus.UNAUTHORIZED)
    return JsonResponse({"user": user})


def get_release_announcement_status(handler, params):
    user = handler.current_user()
    if not user:
        return JsonResponse({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
    handler._actor_id = user["id"]
    with connect_db() as conn:
        return JsonResponse(release_announcement_status(conn, user["id"], params["version"]))


def post_release_announcement_acknowledgement(handler, params):
    user = handler.current_user()
    if not user:
        return JsonResponse({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
    handler._actor_id = user["id"]
    with connect_db() as conn:
        return JsonResponse(acknowledge_release_announcement(conn, user["id"], params["version"]))


API_ROUTER = Router()
API_ROUTER.add(
    "GET", r"/api/health", lambda h, p: JsonResponse({"ok": True, "database": str(DB_PATH), "system": system_info()})
)
API_ROUTER.add("GET", r"/api/system/info", lambda handler, params: JsonResponse(system_info()))
API_ROUTER.add("GET", r"/api/iacuc-index", iacuc_index_handler)
API_ROUTER.add("GET", r"/api/iacuc-index/expiry", iacuc_expiry_handler)
API_ROUTER.add("POST", r"/api/intake/ai-parse", intake_ai_parse_handler)
API_ROUTER.add("POST", r"/api/intake/standardize-strain", intake_strain_standardize_handler)
API_ROUTER.add("GET", r"/api/auth/me", current_session_response)
API_ROUTER.add(
    "GET",
    r"/api/release-announcements/(?P<version>[A-Za-z0-9][A-Za-z0-9._-]{0,63})",
    get_release_announcement_status,
)
API_ROUTER.add(
    "POST",
    r"/api/release-announcements/(?P<version>[A-Za-z0-9][A-Za-z0-9._-]{0,63})/acknowledge",
    post_release_announcement_acknowledgement,
)
