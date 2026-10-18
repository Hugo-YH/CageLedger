"""Private conditional responses; existing dashboard JSON stays unchanged."""

import hashlib
import json
from http import HTTPStatus


def send_overview(handler, payload):
    encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")).encode()
    etag = f'W/"{hashlib.sha256(encoded).hexdigest()}"'
    matches = handler.headers.get("If-None-Match", "").split(",")
    if any(value.strip() == "*" or value.strip().removeprefix("W/") == etag.removeprefix("W/") for value in matches):
        handler.send_response(HTTPStatus.NOT_MODIFIED)
        handler.send_header("ETag", etag)
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()
        return
    handler.send_json(payload, extra_headers={"ETag": etag})
