"""GET lifecycle: registered APIs first, then existing static/SPA fallbacks."""

from http import HTTPStatus
from urllib.parse import urlparse

from server_app.config import frontend_root
from server_app.static import is_private_frontend_path, send_documentation_asset, send_frontend_asset
from server_app.web.read_actions import ReadActionsMixin
from server_app.web.router_registry import API_ROUTER


class ReadRoutesMixin(ReadActionsMixin):
    def do_HEAD(self):
        # HEAD is only a public static operation. Never invoke API GET actions
        # that synchronize receivables or otherwise have legacy side effects.
        if urlparse(self.path).path.startswith("/api/"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self._head_only = True
        try:
            self.do_GET()
        finally:
            self._head_only = False

    def do_GET(self):
        path = urlparse(self.path).path
        if API_ROUTER.handle("GET", path, self):
            return
        if is_private_frontend_path(self.path):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if path.startswith("/scan/cage-card/") or path.startswith("/c/"):
            self.send_spa_index()
            return
        if path in {"/docs/app", "/docs/app/"}:
            self.send_response(302)
            self.send_header("Location", "/app")
            self.end_headers()
            return
        if send_documentation_asset(self, frontend_root()):
            return
        if send_frontend_asset(self, frontend_root()):
            return
        if not path.startswith("/api/") and "." not in path.rsplit("/", 1)[-1]:
            self.send_spa_index()
            return
        # SimpleHTTPRequestHandler's fallback serves arbitrary checkout files
        # and directory listings, bypassing the explicit public asset resolver.
        self.send_error(HTTPStatus.NOT_FOUND)
