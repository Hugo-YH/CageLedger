import json
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler

from server_app.config import MAX_BODY_BYTES, frontend_root
from server_app.http import add_default_headers, send_download
from server_app.http import send_json as send_json_response


class CageLedgerHttpHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(frontend_root()), **kwargs)

    def handle_one_request(self):
        self._request_started_at = time.perf_counter()
        super().handle_one_request()

    def end_headers(self):
        add_default_headers(self)
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def read_json_body(self):
        raw = self.read_raw_body()
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON body") from exc

    def read_raw_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise ValueError("Missing request body")
        if length > MAX_BODY_BYTES:
            raise ValueError("Request body is too large")
        return self.rfile.read(length)

    def read_optional_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        if length > MAX_BODY_BYTES:
            raise ValueError("Request body is too large")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON body") from exc

    def send_json(self, payload, status=HTTPStatus.OK):
        send_json_response(self, payload, status)

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
