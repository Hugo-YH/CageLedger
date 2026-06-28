import gzip
from http import HTTPStatus
import mimetypes
from pathlib import Path
import threading
from urllib.parse import unquote, urlparse


STATIC_CACHE = {}
STATIC_CACHE_LOCK = threading.Lock()


def send_frontend_asset(handler, root: Path) -> bool:
    request_path = unquote(urlparse(handler.path).path)
    relative = request_path.lstrip("/")
    if not relative or relative.endswith("/"):
        return False
    try:
        target = (root / relative).resolve()
        target.relative_to(root.resolve())
    except (ValueError, OSError):
        return False
    if not target.is_file():
        return False

    stat = target.stat()
    accepts_gzip = "gzip" in handler.headers.get("Accept-Encoding", "").lower()
    use_gzip = accepts_gzip and stat.st_size >= 1024
    encoding = "gzip" if use_gzip else "identity"
    etag = f'W/"{stat.st_mtime_ns:x}-{stat.st_size:x}-{encoding}"'
    if handler.headers.get("If-None-Match") == etag:
        handler.send_response(HTTPStatus.NOT_MODIFIED)
        handler.send_header("ETag", etag)
        handler.end_headers()
        return True

    cache_key = (str(target), stat.st_mtime_ns, stat.st_size, encoding)
    with STATIC_CACHE_LOCK:
        body = STATIC_CACHE.get(cache_key)
    if body is None:
        raw = target.read_bytes()
        body = gzip.compress(raw, compresslevel=6) if use_gzip else raw
        with STATIC_CACHE_LOCK:
            if len(STATIC_CACHE) >= 64:
                STATIC_CACHE.clear()
            STATIC_CACHE[cache_key] = body

    content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    if content_type.startswith("text/") or content_type in {"application/javascript", "application/json", "image/svg+xml"}:
        content_type = f"{content_type}; charset=utf-8"
    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("ETag", etag)
    handler.send_header("Vary", "Accept-Encoding")
    if use_gzip:
        handler.send_header("Content-Encoding", "gzip")
    handler.end_headers()
    handler.wfile.write(body)
    return True
