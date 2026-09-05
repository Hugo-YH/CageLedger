import sqlite3
import threading
import time

from .config import DB_PATH, SLOW_DATABASE_THRESHOLD_MS
from .performance import record_database_operation
from .shared.sqlite import ClosingConnection
from .storage_layout import ensure_storage_layout

DB_INIT_LOCK = threading.Lock()
DB_READY = False
SCHEMA_INITIALIZER = None


class ObservedConnection(ClosingConnection):
    def execute(self, *args, **kwargs):
        return self._observe(super().execute, *args, **kwargs)

    def executemany(self, *args, **kwargs):
        return self._observe(super().executemany, *args, **kwargs)

    def executescript(self, *args, **kwargs):
        return self._observe(super().executescript, *args, **kwargs)

    def commit(self):
        return self._observe(super().commit)

    @staticmethod
    def _observe(operation, *args, **kwargs):
        started_at = time.perf_counter()
        locked = False
        try:
            return operation(*args, **kwargs)
        except sqlite3.OperationalError as exc:
            locked = "locked" in str(exc).lower() or "busy" in str(exc).lower()
            raise
        finally:
            elapsed_ms = (time.perf_counter() - started_at) * 1000
            record_database_operation(
                elapsed_ms,
                slow=elapsed_ms >= SLOW_DATABASE_THRESHOLD_MS,
                locked=locked,
            )


def configure_database(schema_initializer):
    global SCHEMA_INITIALIZER
    SCHEMA_INITIALIZER = schema_initializer


def connect_db():
    ensure_database_ready()
    conn = sqlite3.connect(DB_PATH, factory=ObservedConnection)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.execute("PRAGMA cache_size=-80000")
        conn.execute("PRAGMA mmap_size=268435456")
    except BaseException:
        conn.close()
        raise
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
        ensure_storage_layout()
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, factory=ObservedConnection)
        try:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA temp_store=MEMORY")
            conn.execute("PRAGMA cache_size=-80000")
            conn.execute("PRAGMA mmap_size=268435456")
            SCHEMA_INITIALIZER(conn)
            conn.execute("PRAGMA optimize")
            conn.commit()
            DB_READY = True
        finally:
            conn.close()
