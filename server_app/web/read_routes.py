"""GET lifecycle: registered APIs first, then existing static/SPA fallbacks."""

from urllib.parse import urlparse

from server_app.config import frontend_root
from server_app.static import send_documentation_asset, send_frontend_asset
from server_app.web.read_actions import ReadActionsMixin
from server_app.web.router_registry import API_ROUTER


class ReadRoutesMixin(ReadActionsMixin):
    def do_GET(self):
        path = urlparse(self.path).path
        if API_ROUTER.handle("GET", path, self):
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
        super().do_GET()
