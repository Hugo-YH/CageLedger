import hashlib
import logging
import sqlite3
import sys
import threading
import time
from pathlib import Path

from .config import DB_PATH, SLOW_DATABASE_THRESHOLD_MS, SQLITE_CACHE_KIB, SQLITE_MMAP_BYTES
from .performance import record_database_operation, record_stage
from .runtime_logging import emit_event
from .shared.sqlite import ClosingConnection
from .storage_layout import ensure_storage_layout

DB_INIT_LOCK = threading.Lock()
DB_READY = False
SCHEMA_INITIALIZER = None


class ObservedCursor(sqlite3.Cursor):
    """Fetch work is separate from execute; iteration is aggregated per batch."""

    _fetch_ms = 0.0
    _fetch_rows = 0

    def execute(self, *args, **kwargs):
        self._flush_fetch()
        return self.connection._observe(super().execute, *args, **kwargs)

    def executemany(self, *args, **kwargs):
        self._flush_fetch()
        return self.connection._observe(super().executemany, *args, **kwargs)

    def executescript(self, *args, **kwargs):
        self._flush_fetch()
        return self.connection._observe(super().executescript, *args, **kwargs)

    def _fetch(self, operation, *args, **kwargs):
        self._flush_fetch()
        started = time.perf_counter()
        rows = operation(*args, **kwargs)
        count = int(rows is not None) if operation.__name__ == "fetchone" else len(rows)
        record_stage("database.fetch", (time.perf_counter() - started) * 1000, rows=count)
        return rows

    def fetchone(self):
        return self._fetch(super().fetchone)

    def fetchmany(self, *args, **kwargs):
        return self._fetch(super().fetchmany, *args, **kwargs)

    def fetchall(self):
        return self._fetch(super().fetchall)

    def __next__(self):
        started = time.perf_counter()
        try:
            row = super().__next__()
        except StopIteration:
            self._flush_fetch()
            raise
        self._fetch_ms += (time.perf_counter() - started) * 1000
        self._fetch_rows += 1
        if self._fetch_rows >= 256:
            self._flush_fetch()
        return row

    def _flush_fetch(self):
        if self._fetch_rows:
            record_stage("database.fetch", self._fetch_ms, rows=self._fetch_rows)
            self._fetch_ms = 0.0
            self._fetch_rows = 0

    def close(self):
        self._flush_fetch()
        return super().close()


class ObservedConnection(ClosingConnection):
    def cursor(self, factory=ObservedCursor):
        return super().cursor(factory)

    def execute(self, *args, **kwargs):
        return self.cursor().execute(*args, **kwargs)

    def executemany(self, *args, **kwargs):
        return self.cursor().executemany(*args, **kwargs)

    def executescript(self, *args, **kwargs):
        return self.cursor().executescript(*args, **kwargs)

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
                while caller.f_code.co_filename == __file__ and caller.f_back is not None:
                    caller = caller.f_back
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
        conn.execute(f"PRAGMA cache_size={-SQLITE_CACHE_KIB}")
        conn.execute(f"PRAGMA mmap_size={SQLITE_MMAP_BYTES}")
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
            conn.execute(f"PRAGMA cache_size={-SQLITE_CACHE_KIB}")
            conn.execute(f"PRAGMA mmap_size={SQLITE_MMAP_BYTES}")
            SCHEMA_INITIALIZER(conn)
            conn.execute("PRAGMA optimize")
            conn.commit()
            DB_READY = True
        finally:
            conn.close()
