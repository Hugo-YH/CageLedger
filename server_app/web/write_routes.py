"""Write lifecycle: retain origin validation before dispatching any API."""

from http import HTTPStatus
from urllib.parse import urlparse

from server_app.web.router_registry import API_ROUTER
from server_app.web.write_actions import WriteActionsMixin


class WriteRoutesMixin(WriteActionsMixin):
    def _dispatch_write(self, method):
        if not self.require_safe_origin():
            return
        if not API_ROUTER.handle(method, urlparse(self.path).path, self):
            self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self):
        self._dispatch_write("POST")

    def do_PUT(self):
        self._dispatch_write("PUT")

    def do_DELETE(self):
        self._dispatch_write("DELETE")
