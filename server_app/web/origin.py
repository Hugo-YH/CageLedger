"""Same-origin enforcement for cookie-authenticated write requests."""

from urllib.parse import urlsplit

from server_app.config import CORS_ALLOWED_ORIGINS


def request_origin(headers):
    return (headers.get("Origin") or "").strip().rstrip("/")


def is_origin_allowed(headers):
    origin = request_origin(headers)
    if not origin:
        return True
    try:
        parsed = urlsplit(origin)
    except ValueError:
        return False
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        return False
    host = (headers.get("Host") or "").strip().lower()
    return parsed.netloc.lower() == host or origin in CORS_ALLOWED_ORIGINS


def cors_response_origin(headers):
    origin = request_origin(headers)
    return origin if origin and is_origin_allowed(headers) else ""
