"""Process configuration and HTTP server lifecycle."""

import logging
from http.server import ThreadingHTTPServer

from server_app.config import HOST, PORT
from server_app.db import configure_database, ensure_database_ready
from server_app.domains.administration.performance_history import start_performance_history_sampler
from server_app.domains.administration.system import system_environment
from server_app.domains.feedback import worker as feedback_worker
from server_app.domains.iacuc.auto_import import start_auto_import_watcher
from server_app.pdf.renderer import prewarm_pdf_renderer
from server_app.runtime_logging import configure_runtime_logging, emit_event


def configure(schema_initializer):
    configure_database(schema_initializer)


def serve(handler_class):
    configure_runtime_logging()
    try:
        _serve(handler_class)
    except Exception as exc:
        emit_event("server_failed", level=logging.ERROR, error=exc)
        raise


def _serve(handler_class):
    ensure_database_ready()
    prewarm_pdf_renderer()
    start_auto_import_watcher()
    start_performance_history_sampler(system_environment)
    feedback_worker.start()
    server = ThreadingHTTPServer((HOST, PORT), handler_class)
    emit_event("server_started", port=PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        feedback_worker.stop()
        server.server_close()
        emit_event("server_stopped")
