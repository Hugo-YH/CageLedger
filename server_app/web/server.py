"""Bounded connection admission for the existing threaded HTTP server."""

import json
import logging
from http.server import ThreadingHTTPServer
from threading import BoundedSemaphore

from server_app.config import HTTP_MAX_WORKERS
from server_app.runtime_logging import emit_event


class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    def __init__(self, server_address, handler_class, *, max_workers=HTTP_MAX_WORKERS):
        self.max_workers = max(int(max_workers), 1)
        self._admission = BoundedSemaphore(self.max_workers)
        super().__init__(server_address, handler_class)

    def process_request(self, request, client_address):
        if not self._admission.acquire(blocking=False):
            try:
                body = json.dumps({"error": "服务暂时繁忙，请稍后重试"}, ensure_ascii=False).encode("utf-8")
                request.settimeout(1)
                request.sendall(
                    b"HTTP/1.0 503 Service Unavailable\r\n"
                    b"Content-Type: application/json; charset=utf-8\r\n"
                    b"Connection: close\r\nCache-Control: no-store\r\nRetry-After: 1\r\n"
                    + f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
                    + body
                )
            except OSError:
                # No user request was executed; the peer may already be gone.
                emit_event("http_capacity_client_disconnected", rate_limit=True)
            finally:
                self.shutdown_request(request)
            emit_event(
                "http_capacity_rejected",
                level=logging.WARNING,
                rate_limit=True,
                count=self.max_workers,
                status=503,
                durationMs=0,
            )
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._admission.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._admission.release()
