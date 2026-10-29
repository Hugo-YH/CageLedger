"""Process configuration and HTTP server lifecycle."""

import logging
import signal
from contextlib import contextmanager
from threading import Event, Thread, current_thread, main_thread
from types import SimpleNamespace

from server_app.config import HOST, PORT
from server_app.db import configure_database, ensure_database_ready
from server_app.domains.administration.performance_history import start_performance_history_sampler
from server_app.domains.administration.system import system_environment
from server_app.domains.feedback import worker as feedback_worker
from server_app.domains.iacuc.auto_import import start_auto_import_watcher
from server_app.pdf.renderer import prewarm_pdf_renderer, shutdown_pdf_renderer
from server_app.runtime_logging import configure_runtime_logging, emit_event
from server_app.web.server import BoundedThreadingHTTPServer as ThreadingHTTPServer


def configure(schema_initializer):
    configure_database(schema_initializer)


def serve(handler_class):
    configure_runtime_logging()
    with _shutdown_signals() as shutdown:
        try:
            _serve(handler_class, shutdown)
        except Exception as exc:
            emit_event("server_failed", level=logging.ERROR, error=exc)
            raise


def _serve(handler_class, shutdown=None):
    shutdown = shutdown or SimpleNamespace(requested=False)
    server = None
    server_thread = None
    feedback_started = False
    finished = Event()
    errors = []

    def accept_requests():
        try:
            server.serve_forever()
        except BaseException as exc:
            errors.append(exc)
        finally:
            finished.set()

    try:
        ensure_database_ready()
        if shutdown.requested:
            return
        prewarm_pdf_renderer()
        if shutdown.requested:
            return
        start_auto_import_watcher()
        start_performance_history_sampler(system_environment)
        feedback_worker.start()
        feedback_started = True
        server = ThreadingHTTPServer((HOST, PORT), handler_class)
        emit_event("server_started", port=PORT)
        if not shutdown.requested:
            server_thread = Thread(target=accept_requests, name="cageledger-http", daemon=True)
            server_thread.start()
            while not shutdown.requested and not finished.wait(0.1):
                pass
            if errors:
                raise errors[0]
    except KeyboardInterrupt:
        pass
    finally:
        try:
            if server_thread and server_thread.is_alive():
                # BaseServer.shutdown must be called outside serve_forever's thread.
                server.shutdown()
                server_thread.join()
            if feedback_started:
                feedback_worker.stop()
            if server:
                server.server_close()
        finally:
            shutdown_pdf_renderer()
        if server:
            emit_event("server_stopped")


@contextmanager
def _shutdown_signals():
    shutdown = SimpleNamespace(requested=False)
    if current_thread() is not main_thread():
        yield shutdown
        return
    previous = {}

    def stop(_signum, _frame):
        # No locks or asynchronous exceptions inside startup/queue critical sections.
        shutdown.requested = True

    try:
        for name in (signal.SIGINT, signal.SIGTERM):
            previous[name] = signal.signal(name, stop)
        yield shutdown
    finally:
        for name, handler in previous.items():
            signal.signal(name, handler)
