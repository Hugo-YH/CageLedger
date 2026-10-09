"""One serial worker; durable outbox and short transactions around external requests."""

import sqlite3
import threading
import time

from server_app.config import CAGELEDGER_GITEA_TOKEN, CAGELEDGER_REPOSITORY_URL, FEEDBACK_FILES_PATH
from server_app.db import connect_db

from . import repository as repo
from . import sync
from .gitea import Client, RemoteError

_lock = threading.Lock()
_thread = None
_stop = threading.Event()
_resume = threading.Event()
_health_lock = threading.Lock()
_health_state = "recovering"
_health_error = ""


def _set_health(state, error=""):
    global _health_state, _health_error
    with _health_lock:
        _health_state, _health_error = state, error


def health():
    with _lock, _health_lock:
        if not CAGELEDGER_GITEA_TOKEN:
            return {"workerState": "unconfigured", "workerError": ""}
        if _health_state == "blocked" and not _stop.is_set():
            return {"workerState": "blocked", "workerError": _health_error}
        if not _thread or not _thread.is_alive() or _stop.is_set():
            return {
                "workerState": "stopped",
                "workerError": "反馈同步服务已停止，请在反馈详情点击“同步 Gitea”重试",
            }
        return {"workerState": _health_state, "workerError": _health_error}


def recover(conn):
    # A crashed POST remains uncertain. Restart only reconciles its stable remote marker.
    if conn.execute("SELECT 1 FROM feedback_tasks WHERE state='working' LIMIT 1").fetchone():
        conn.execute("UPDATE feedback_tasks SET state='pending',due_at=0 WHERE state='working'")


def run_once(connect, client, root):
    if client.auth_blocked:
        return False
    with connect() as conn:
        # An idle queue needs no writer lock. Recheck the task after acquiring the transaction.
        if not conn.execute(
            "SELECT 1 FROM feedback_tasks WHERE state='pending' AND due_at<=? LIMIT 1", (time.time(),)
        ).fetchone():
            return False
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            """SELECT * FROM feedback_tasks WHERE state='pending' AND due_at<=?
               ORDER BY CASE kind WHEN 'create' THEN 0 WHEN 'comment' THEN 1 WHEN 'asset' THEN 2 ELSE 3 END,id LIMIT 1""",
            (time.time(),),
        ).fetchone()
        if not row:
            return False
        task = dict(row)
        feedback = repo.get(conn, task["feedback_id"])
        if feedback["repository"] != client.repository:
            conn.execute(
                "UPDATE feedback_tasks SET state='blocked',error=? WHERE id=?",
                ("共享仓库地址已变更，历史反馈暂停同步；不会向新仓库重复建单", task["id"]),
            )
            return True
        entity = None
        if task["kind"] == "comment":
            entity = dict(conn.execute("SELECT * FROM feedback_comments WHERE id=?", (task["entity_id"],)).fetchone())
        elif task["kind"] == "asset":
            entity = dict(
                conn.execute("SELECT * FROM feedback_attachments WHERE id=?", (task["entity_id"],)).fetchone()
            )
            if entity["comment_id"]:
                entity["comment"] = dict(
                    conn.execute("SELECT * FROM feedback_comments WHERE id=?", (entity["comment_id"],)).fetchone()
                )
        elif task["kind"] == "encounters":
            entity = {
                "count": conn.execute(
                    "SELECT COUNT(*) FROM feedback_encounters WHERE feedback_id=?", (feedback["id"],)
                ).fetchone()[0]
            }
        # Save potential uncertainty BEFORE calling POST, covering process death after remote success.
        mutating = task["kind"] in {"create", "comment", "asset", "encounters"}
        conn.execute(
            "UPDATE feedback_tasks SET state='working',started_at=?,uncertain=? WHERE id=?",
            (time.time(), int(mutating or task["uncertain"]), task["id"]),
        )
    try:
        try:
            result = sync.perform(client, task, feedback, entity, root)
        except RemoteError as exc:
            if exc.http_status != 404 or not feedback["issue_number"] or not sync.confirmed_deleted(client, feedback):
                raise
            result = {"deleted": True}
        with connect() as conn:
            sync.apply(conn, task, feedback, result)
            conn.execute(
                """UPDATE feedback_tasks SET state=CASE WHEN generation=? OR ? THEN 'done' ELSE 'pending' END,
                   due_at=0,uncertain=0,error='',attempts=0 WHERE id=?""",
                (task["generation"], bool(result.get("deleted")), task["id"]),
            )
    except (RemoteError, OSError, ValueError, KeyError, TypeError) as exc:
        if not isinstance(exc, RemoteError):
            exc = RemoteError("同步响应或本地附件无效，请管理员检查", permanent=True, uncertain=mutating)
        attempts = task["attempts"] + 1
        with connect() as conn:
            conn.execute(
                "UPDATE feedback_tasks SET state=?,attempts=?,due_at=?,uncertain=?,error=? WHERE id=?",
                (
                    "blocked" if exc.permanent else "pending",
                    attempts,
                    time.time() + min(3600, 15 * 2 ** min(attempts, 8)),
                    int(bool(task["uncertain"] or exc.uncertain)),
                    str(exc),
                    task["id"],
                ),
            )
            if client.auth_blocked:
                conn.execute("UPDATE feedback_tasks SET state='blocked',error=? WHERE state='pending'", (str(exc),))
    return True


def _run():
    try:
        client = Client(CAGELEDGER_REPOSITORY_URL, CAGELEDGER_GITEA_TOKEN)
    except ValueError:
        message = "共享仓库地址无效，请管理员检查配置"
        _set_health("blocked", message)
        while not _stop.is_set():
            try:
                with connect_db() as conn:
                    conn.execute("UPDATE feedback_tasks SET state='blocked',error=? WHERE state!='done'", (message,))
                break
            except Exception:
                _stop.wait(5)
        return
    last_poll = 0
    needs_recovery = True
    while not _stop.is_set():
        try:
            # Recovery belongs to the protected loop too: repeated DB locks must not kill the worker.
            if needs_recovery:
                with connect_db() as conn:
                    recover(conn)
                needs_recovery = False
            if _resume.is_set():
                client.auth_blocked = False
                _resume.clear()
            if time.monotonic() - last_poll >= 300:
                with connect_db() as conn:
                    repo.queue_stale(conn)
                last_poll = time.monotonic()
            worked = run_once(connect_db, client, FEEDBACK_FILES_PATH)
            _set_health(
                "blocked" if client.auth_blocked else "running",
                "Gitea 凭据或工单权限不足，请管理员处理后重试同步" if client.auth_blocked else "",
            )
            _stop.wait(0.2 if worked else 2)
        except Exception as exc:
            # Never expose raw exceptions, request/response bodies, SQL or credentials.
            needs_recovery = True
            message = "反馈同步服务暂时受阻，后台正在重试"
            if isinstance(exc, sqlite3.OperationalError) and any(
                word in str(exc).lower() for word in ("locked", "busy")
            ):
                message = "数据库暂时繁忙，反馈同步服务正在重试"
            _set_health("recovering", message)
            _stop.wait(5)


def start():
    global _thread
    # Update-check enablement deliberately has no effect on feedback synchronization.
    if not CAGELEDGER_GITEA_TOKEN:
        return
    with _lock:
        if _thread and _thread.is_alive():
            return
        _stop.clear()
        _set_health("recovering")
        _thread = threading.Thread(target=_run, name="feedback-gitea", daemon=True)
        _thread.start()


def stop():
    _stop.set()


def resume():
    _resume.set()
    start()
