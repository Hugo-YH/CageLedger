import sqlite3
import threading

from .config import DB_PATH


DB_INIT_LOCK = threading.Lock()
DB_READY = False
SCHEMA_INITIALIZER = None


def configure_database(schema_initializer):
    global SCHEMA_INITIALIZER
    SCHEMA_INITIALIZER = schema_initializer


def connect_db():
    ensure_database_ready()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA temp_store=MEMORY")
    return conn


def ensure_database_ready():
    global DB_READY
    if DB_READY:
        return
    if SCHEMA_INITIALIZER is None:
        raise RuntimeError("Database schema initializer is not configured")
    with DB_INIT_LOCK:
        if DB_READY:
            return
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA temp_store=MEMORY")
            SCHEMA_INITIALIZER(conn)
            conn.execute("PRAGMA optimize")
            conn.commit()
            DB_READY = True
        finally:
            conn.close()
