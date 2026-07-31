from http import HTTPStatus
from urllib.parse import parse_qs, urlparse

from server_app.config import IACUC_INDEX_PATH, LEGACY_IACUC_INDEX_PATH
from server_app.db import connect_db
from server_app.repositories.iacuc import filter_iacuc_index, read_iacuc_index
from server_app.web import JsonResponse


def iacuc_index_handler(handler, _params):
    user = handler.current_user()
    if not user:
        return JsonResponse({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
    query = parse_qs(urlparse(handler.path).query)
    with connect_db() as conn:
        payload = read_iacuc_index(conn, IACUC_INDEX_PATH, LEGACY_IACUC_INDEX_PATH)
    q = query.get("q", [""])[0]
    limit = _bounded_int(query.get("limit", [""])[0], 80, 1, 500)
    return JsonResponse(filter_iacuc_index(payload, q, limit))


def _bounded_int(value, default, min_value, max_value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(min_value, min(number, max_value))
