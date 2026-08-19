"""Process configuration and HTTP server lifecycle."""

from http.server import ThreadingHTTPServer

from server_app.config import DB_PATH, HOST, PORT
from server_app.db import configure_database, ensure_database_ready
from server_app.domains.iacuc.auto_import import start_auto_import_watcher
from server_app.pdf.renderer import prewarm_pdf_renderer


def configure(schema_initializer):
    configure_database(schema_initializer)


def serve(handler_class):
    ensure_database_ready()
    prewarm_pdf_renderer()
    start_auto_import_watcher()
    server = ThreadingHTTPServer((HOST, PORT), handler_class)
    print(f"CageLedger server listening on http://{HOST}:{PORT}")
    print(f"SQLite database: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
