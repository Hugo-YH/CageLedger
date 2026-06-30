import gzip
import json
import time
from http import HTTPStatus
from urllib.parse import urlparse


def add_default_headers(handler):
    path = urlparse(handler.path).path
    if not path.startswith("/api/"):
        if path.startswith("/assets/"):
            handler.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            handler.send_header("Cache-Control", "no-cache")
    started_at = getattr(handler, "_request_started_at", None)
    if started_at is not None:
        handler.send_header("Server-Timing", f"app;dur={(time.perf_counter() - started_at) * 1000:.1f}")
    handler.send_header("X-Content-Type-Options", "nosniff")


def send_json(handler, payload, status=HTTPStatus.OK):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    accepts_gzip = "gzip" in handler.headers.get("Accept-Encoding", "").lower()
    compressed = accepts_gzip and len(body) >= 1024
    if compressed:
        body = gzip.compress(body, compresslevel=5)
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Vary", "Accept-Encoding")
    if compressed:
        handler.send_header("Content-Encoding", "gzip")
    handler.end_headers()
    handler.wfile.write(body)
