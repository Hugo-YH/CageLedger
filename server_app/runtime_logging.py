"""Bounded runtime logs, independent of SQLite and container lifetime."""

import json
import logging
import os
import sys
import threading
import time
import traceback
from collections import OrderedDict
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from functools import wraps
from logging.handlers import RotatingFileHandler
from pathlib import Path

from server_app import config

_LOGGER = logging.getLogger("cageledger.runtime")
_LOGGER.addHandler(logging.NullHandler())
_LOGGER.propagate = False
_CONTEXT = ContextVar("cageledger_log_context", default=None)
_HANDLERS = []
_RATE_LOCK = threading.Lock()
_RATE_WINDOWS = OrderedDict()
_PREVIOUS_HOOKS = None
_FIELDS = frozenset(
    {
        "requestId",
        "method",
        "route",
        "component",
        "stage",
        "operation",
        "sqlOperation",
        "queryId",
        "source",
        "function",
        "line",
        "returnCode",
        "status",
        "durationMs",
        "applicationMs",
        "responseBytes",
        "actorId",
        "category",
        "slow",
        "rowCount",
        "count",
        "changedIacucCount",
        "updatedRecordCount",
        "port",
        "persistent",
        "maxBytes",
        "fileCount",
        "suppressedCount",
        "errorType",
        "errno",
        "jobId",
        "tasks",
        "batches",
        "rooms",
        "cached",
        "slot_count",
        "affected",
        "rows",
    }
)


def _safe_fields(fields):
    return {
        key: value[:160] if isinstance(value, str) else value
        for key, value in fields.items()
        if key in _FIELDS and isinstance(value, str | int | float | bool)
    }


@contextmanager
def log_context(**fields):
    token = _CONTEXT.set({**(_CONTEXT.get() or {}), **_safe_fields(fields)})
    try:
        yield
    finally:
        _CONTEXT.reset(token)


def update_log_context(**fields):
    _CONTEXT.set({**(_CONTEXT.get() or {}), **_safe_fields(fields)})


def capture_log_context():
    return dict(_CONTEXT.get() or {})


def bind_log_context(callback):
    fields = capture_log_context()

    @wraps(callback)
    def run(*args, **kwargs):
        with log_context(**fields):
            try:
                return callback(*args, **kwargs)
            except Exception as error:
                emit_event("background_task_failed", level=logging.ERROR, error=error, rate_limit=True)
                raise

    return run


def log_operation(operation, *, component):
    def decorate(function):
        @wraps(function)
        def run(*args, **kwargs):
            started = time.perf_counter()
            with log_context(component=component, operation=operation):
                try:
                    result = function(*args, **kwargs)
                except Exception as error:
                    emit_event(
                        operation + "_failed",
                        level=logging.WARNING,
                        error=error,
                        rate_limit=True,
                        durationMs=round((time.perf_counter() - started) * 1000, 1),
                    )
                    raise
                emit_event(operation + "_completed", durationMs=round((time.perf_counter() - started) * 1000, 1))
                return result

        return run

    return decorate


def _frames(error):
    frames = list(traceback.walk_tb(error.__traceback__)) if error.__traceback__ else []
    # A DB exception is logged before propagating to its caller; retain that caller too.
    callers = list(traceback.walk_stack(sys._getframe(1)))
    callers.reverse()
    return [
        {"file": Path(frame.f_code.co_filename).name, "function": frame.f_code.co_name, "line": line}
        for frame, line in (callers + frames)[-12:]
        if frame.f_code.co_filename != __file__
    ]


def _rate_limit(event, fields, error):
    key = (
        event,
        fields.get("queryId") or threading.current_thread().name,
        fields.get("stage"),
        fields.get("operation"),
        fields.get("sqlOperation"),
        type(error).__name__,
    )
    now = time.monotonic()
    with _RATE_LOCK:
        previous = _RATE_WINDOWS.pop(key, None)
        if previous and now - previous[0] < 60:
            _RATE_WINDOWS[key] = (previous[0], previous[1] + 1)
            return None
        _RATE_WINDOWS[key] = (now, 0)
        if len(_RATE_WINDOWS) > 128:
            _RATE_WINDOWS.popitem(last=False)
    return previous[1] if previous else 0


def emit_event(event, *, level=logging.INFO, error=None, rate_limit=False, **fields):
    """Never let diagnostics change a business result; omit messages, SQL and values."""
    try:
        data = {**(_CONTEXT.get() or {}), **_safe_fields(fields)}
        if rate_limit:
            suppressed = _rate_limit(event, data, error)
            if suppressed is None:
                return
            if suppressed:
                data["suppressedCount"] = suppressed
        if error is not None:
            data["errorType"] = type(error).__name__
            http_status = getattr(error, "http_status", None) or getattr(error, "code", None)
            if isinstance(http_status, int):
                data["httpStatus"] = http_status
            for attribute, key in (
                ("sqlite_errorcode", "sqliteCode"),
                ("sqlite_errorname", "sqliteName"),
                ("errno", "errno"),
            ):
                value = getattr(error, attribute, None)
                if isinstance(value, str | int):
                    data[key] = value
            data["frames"] = _frames(error)
            causes = []
            cause = error.__cause__ or error.__context__
            seen = {id(error)}
            while cause is not None and len(causes) < 3 and id(cause) not in seen:
                seen.add(id(cause))
                details = {"errorType": type(cause).__name__}
                if isinstance(getattr(cause, "code", None), int):
                    details["httpStatus"] = cause.code
                causes.append(details)
                cause = cause.__cause__ or cause.__context__
            if causes:
                data["causes"] = causes
        _LOGGER.log(level, event, extra={"diagnostics": data})
    except Exception:  # noqa: BLE001 - even a broken stdout or formatter must not affect business writes.
        pass


class JsonFormatter(logging.Formatter):
    def __init__(self):
        super().__init__()
        try:
            package = json.loads((config.ROOT / "package.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            package = {}
        self.version = config.CAGELEDGER_APP_VERSION or package.get("version", "")
        self.build = config.CAGELEDGER_APP_BUILD or str(package.get("build", ""))

    def format(self, record):
        return json.dumps(
            {
                "at": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
                "level": record.levelname,
                "event": record.msg,
                "appVersion": self.version,
                "appBuild": self.build,
                "revision": config.CAGELEDGER_REVISION,
                "processId": os.getpid(),
                "thread": record.threadName,
                **getattr(record, "diagnostics", {}),
            },
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )


class SafeStreamHandler(logging.StreamHandler):
    def handleError(self, record):
        pass


class SafeRotatingFileHandler(RotatingFileHandler):
    def __init__(self, *args, fallback, **kwargs):
        super().__init__(*args, **kwargs)
        self.fallback = fallback
        self.failed = False

    def emit(self, record):
        if self.failed:
            self.fallback.handle(record)
        else:
            super().emit(record)

    def handleError(self, record):
        self.failed = True
        error = sys.exc_info()[1]
        try:
            self.close()
        except OSError:
            pass
        warning = _LOGGER.makeRecord(
            _LOGGER.name,
            logging.WARNING,
            __file__,
            0,
            "runtime_log_unavailable",
            (),
            None,
            extra={"diagnostics": {"errorType": type(error).__name__}},
        )
        self.fallback.handle(warning)
        self.fallback.handle(record)


def shutdown_runtime_logging():
    global _PREVIOUS_HOOKS
    if _PREVIOUS_HOOKS is not None:
        if sys.excepthook is _uncaught_exception:
            sys.excepthook = _PREVIOUS_HOOKS[0]
        if threading.excepthook is _uncaught_thread_exception:
            threading.excepthook = _PREVIOUS_HOOKS[1]
        _PREVIOUS_HOOKS = None
    for handler in _HANDLERS:
        _LOGGER.removeHandler(handler)
        try:
            handler.close()
        except OSError:
            pass
    _HANDLERS.clear()


def _uncaught_exception(error_type, error, tb):
    if issubclass(error_type, KeyboardInterrupt):
        sys.__excepthook__(error_type, error, tb)
        return
    emit_event("uncaught_exception", level=logging.ERROR, error=error)


def _uncaught_thread_exception(args):
    if not issubclass(args.exc_type, SystemExit):
        emit_event("thread_failed", level=logging.ERROR, error=args.exc_value)


def configure_runtime_logging():
    global _PREVIOUS_HOOKS
    shutdown_runtime_logging()
    with _RATE_LOCK:
        _RATE_WINDOWS.clear()
    formatter = JsonFormatter()
    console = SafeStreamHandler(sys.stdout)
    console.setFormatter(formatter)
    _LOGGER.setLevel(logging.INFO)
    _HANDLERS.append(console)
    persistent = False
    failure = None
    if config.LOG_PERSISTENCE_ENABLED:
        try:
            config.LOG_DIR.mkdir(parents=True, exist_ok=True)
            file_handler = SafeRotatingFileHandler(
                config.LOG_DIR / "runtime.jsonl",
                maxBytes=config.LOG_MAX_BYTES,
                backupCount=config.LOG_FILE_COUNT - 1,
                encoding="utf-8",
                fallback=console,
            )
            file_handler.setFormatter(formatter)
            _LOGGER.addHandler(file_handler)
            _HANDLERS.append(file_handler)
            persistent = True
        except OSError as error:
            failure = error
    if not persistent:
        _LOGGER.addHandler(console)
    if failure is not None:
        emit_event("runtime_log_unavailable", level=logging.WARNING, error=failure)
    emit_event(
        "runtime_logging_started",
        persistent=persistent,
        maxBytes=config.LOG_MAX_BYTES,
        fileCount=config.LOG_FILE_COUNT,
    )
    if persistent:
        console.handle(
            _LOGGER.makeRecord(
                _LOGGER.name,
                logging.INFO,
                __file__,
                0,
                "runtime_logging_destination",
                (),
                None,
                extra={"diagnostics": {"persistent": True, "logPath": str(config.LOG_DIR / "runtime.jsonl")}},
            )
        )
    _PREVIOUS_HOOKS = (sys.excepthook, threading.excepthook)
    sys.excepthook = _uncaught_exception
    threading.excepthook = _uncaught_thread_exception
