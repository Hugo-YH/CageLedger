from http import HTTPStatus
from urllib.parse import parse_qs, urlparse

from server_app.config import IACUC_INDEX_PATH, LEGACY_IACUC_INDEX_PATH
from server_app.db import connect_db
from server_app.repositories.iacuc import filter_iacuc_index, read_iacuc_index
from server_app.web import JsonResponse

IACUC_INDEX_CLIENT_KEYS = ("iacuc", "project", "pi", "owner", "funding", "projectStartDate", "projectEndDate")


def iacuc_index_handler(handler, _params):
    user = handler.current_user()
    if not user:
        return JsonResponse({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
    query = parse_qs(urlparse(handler.path).query)
    with connect_db() as conn:
        payload = read_iacuc_index(conn, IACUC_INDEX_PATH, LEGACY_IACUC_INDEX_PATH)
    q = query.get("q", [""])[0]
    limit = _bounded_int(query.get("limit", [""])[0], 80, 1, 500)
    result = filter_iacuc_index(payload, q, limit)
    result["items"] = [{key: item.get(key) for key in IACUC_INDEX_CLIENT_KEYS} for item in result["items"]]
    return JsonResponse(result)


def iacuc_expiry_handler(handler, _params):
    """精简的 IACUC 到期日索引，仅返回编码与到期日，供列表页批量标记即将到期。"""
    user = handler.current_user()
    if not user:
        return JsonResponse({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
    with connect_db() as conn:
        payload = read_iacuc_index(conn, IACUC_INDEX_PATH, LEGACY_IACUC_INDEX_PATH)
    items = [
        {"iacuc": item.get("iacuc"), "projectEndDate": item.get("projectEndDate")}
        for item in payload.get("items", [])
        if item.get("iacuc")
    ]
    return JsonResponse({"items": items, "count": len(items)})


def _bounded_int(value, default, min_value, max_value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(min_value, min(number, max_value))
