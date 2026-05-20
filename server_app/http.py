import json
from http import HTTPStatus
from urllib.parse import urlparse


def add_default_headers(handler):
    if not urlparse(handler.path).path.startswith("/api/"):
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("Pragma", "no-cache")
        handler.send_header("Expires", "0")
    handler.send_header("X-Content-Type-Options", "nosniff")


def send_json(handler, payload, status=HTTPStatus.OK):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)
