import json
import logging
import secrets
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler

from server_app.config import SLOW_REQUEST_THRESHOLD_MS, frontend_root
from server_app.http import add_default_headers, send_download
from server_app.http import send_json as send_json_response
from server_app.performance import record_request, request_observability
from server_app.web.origin import is_origin_allowed
from server_app.web.request_body import RequestBodyError, parse_json_object, read_body

_LOGGER = logging.getLogger("cageledger.http")


class CageLedgerHttpHandler(SimpleHTTPRequestHandler):
    timeout = 30

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(frontend_root()), **kwargs)

    def handle_one_request(self):
        self._request_id = secrets.token_hex(8)
        self._actor_id = ""
        self._request_started_at = time.perf_counter()
        self._response_status = 0
        self._response_bytes = 0
        self._response_is_download = False
        self._response_started_at = None
        try:
            super().handle_one_request()
        except RequestBodyError as exc:
            self.close_connection = True
            if not self._response_status:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as exc:  # noqa: BLE001 - outer HTTP boundary must contain failures.
            self.close_connection = True
            path = getattr(self, "path", "").split("?", 1)[0]
            _LOGGER.exception(
                "request_failed request_id=%s method=%s route=%s error_type=%s",
                self._request_id,
                getattr(self, "command", ""),
                request_observability(path)[1],
                type(exc).__name__,
            )
            if not self._response_status and path.startswith("/api/"):
                self.send_json(
                    {"error": "服务器暂时无法处理请求", "requestId": self._request_id}, HTTPStatus.INTERNAL_SERVER_ERROR
                )
        finally:
            if getattr(self, "requestline", ""):
                elapsed_ms = (time.perf_counter() - self._request_started_at) * 1000
                slow = elapsed_ms >= SLOW_REQUEST_THRESHOLD_MS
                path = getattr(self, "path", "").split("?", 1)[0]
                category, route = request_observability(path, is_download=getattr(self, "_response_is_download", False))
                response_started_at = getattr(self, "_response_started_at", None)
                application_ms = (
                    (response_started_at - self._request_started_at) * 1000
                    if response_started_at is not None
                    else elapsed_ms
                )
                record_request(
                    elapsed_ms,
                    slow=slow,
                    application_ms=application_ms,
                    category=category,
                    route=route,
                    response_bytes=getattr(self, "_response_bytes", 0),
                    status=getattr(self, "_response_status", 0),
                )
                if path.startswith("/api/") or slow:
                    print(
                        json.dumps(
                            {
                                "event": "http_request",
                                "requestId": self._request_id,
                                "method": getattr(self, "command", ""),
                                "route": route,
                                "status": self._response_status or 0,
                                "durationMs": round(elapsed_ms, 1),
                                "applicationMs": round(application_ms, 1),
                                "responseBytes": self._response_bytes or 0,
                                "actorId": self._actor_id,
                                "category": category,
                                "slow": slow,
                            },
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ),
                        flush=True,
                    )

    def send_response(self, code, message=None):
        self._response_status = int(code)
        if self._response_started_at is None:
            self._response_started_at = time.perf_counter()
        super().send_response(code, message)

    def send_header(self, keyword, value):
        normalized = keyword.lower()
        if normalized == "content-length":
            try:
                self._response_bytes = max(int(value), 0)
            except (TypeError, ValueError):
                self._response_bytes = 0
        elif normalized == "content-disposition" and "attachment" in str(value).lower():
            self._response_is_download = True
        super().send_header(keyword, value)

    def end_headers(self):
        add_default_headers(self)
        super().end_headers()

    def do_OPTIONS(self):
        if not self.require_safe_origin():
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def require_safe_origin(self):
        if is_origin_allowed(self.headers):
            return True
        self.send_json({"error": "请求来源不受信任"}, HTTPStatus.FORBIDDEN)
        return False

    def log_message(self, _format, *_args):
        """Access logging is emitted once from handle_one_request without query strings."""

    def read_json_body(self):
        return parse_json_object(self.read_raw_body())

    def read_raw_body(self):
        return read_body(self.headers, self.rfile)

    def read_optional_json_body(self):
        raw = read_body(self.headers, self.rfile, optional=True)
        return parse_json_object(raw) if raw else {}

    def send_json(self, payload, status=HTTPStatus.OK, extra_headers=None):
        send_json_response(self, payload, status, extra_headers)

    def send_download(self, body, filename, content_type, status=HTTPStatus.OK):
        send_download(self, body, filename, content_type, status)

    def send_spa_index(self):
        body = (frontend_root() / "index.html").read_text(encoding="utf-8")
        if "<base " not in body:
            body = body.replace("<head>", '<head>\n    <base href="/" />', 1)
        body_bytes = body.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)
