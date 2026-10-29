import hashlib
import logging
import sqlite3
import sys
import threading
import time
from pathlib import Path

from .config import DB_PATH, SLOW_DATABASE_THRESHOLD_MS
from .performance import record_database_operation
from .runtime_logging import emit_event
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
        failure = None
        try:
            return operation(*args, **kwargs)
        except sqlite3.Error as exc:
            locked = isinstance(exc, sqlite3.OperationalError) and (
                "locked" in str(exc).lower() or "busy" in str(exc).lower()
            )
            failure = exc
            raise
        finally:
            elapsed_ms = (time.perf_counter() - started_at) * 1000
            record_database_operation(
                elapsed_ms,
                slow=elapsed_ms >= SLOW_DATABASE_THRESHOLD_MS,
                locked=locked,
            )
            if elapsed_ms >= SLOW_DATABASE_THRESHOLD_MS and failure is None:
                statement = args[0] if args and isinstance(args[0], str) else ""
                caller = sys._getframe(2)
                emit_event(
                    "database_slow_operation",
                    level=logging.WARNING,
                    rate_limit=True,
                    operation=operation.__name__,
                    queryId=hashlib.sha256(" ".join(statement.split()).encode("utf-8", "surrogatepass")).hexdigest()[
                        :16
                    ],
                    source=Path(caller.f_code.co_filename).name,
                    function=caller.f_code.co_name,
                    line=caller.f_lineno,
                    durationMs=round(elapsed_ms, 1),
                )
            if failure is not None:
                tokens = args[0].split(None, 1) if args and isinstance(args[0], str) else []
                sql = tokens[0].upper() if tokens else ""
                emit_event(
                    "database_lock_error" if locked else "database_operation_failed",
                    level=logging.WARNING if locked or isinstance(failure, sqlite3.IntegrityError) else logging.ERROR,
                    error=failure,
                    rate_limit=True,
                    operation=operation.__name__,
                    queryId=hashlib.sha256(
                        " ".join(args[0].split()).encode("utf-8", "surrogatepass")
                        if args and isinstance(args[0], str)
                        else b""
                    ).hexdigest()[:16],
                    sqlOperation=sql if sql in {"SELECT", "INSERT", "UPDATE", "DELETE", "BEGIN", "PRAGMA"} else "OTHER",
                    durationMs=round(elapsed_ms, 1),
                )


def configure_database(schema_initializer):
    global SCHEMA_INITIALIZER
    SCHEMA_INITIALIZER = schema_initializer


def connect_db():
    ensure_database_ready()
    started = time.perf_counter()
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
    elapsed_ms = (time.perf_counter() - started) * 1000
    if elapsed_ms >= SLOW_DATABASE_THRESHOLD_MS:
        emit_event("performance_operation", operation="database.connect", durationMs=round(elapsed_ms, 1))
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
