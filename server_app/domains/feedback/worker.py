"""One serial worker; durable outbox and short transactions around external requests."""

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


def recover(conn):
    # A crashed POST remains uncertain. Restart only reconciles its stable remote marker.
    conn.execute("UPDATE feedback_tasks SET state='pending',due_at=0 WHERE state='working'")


def run_once(connect, client, root):
    if client.auth_blocked:
        return False
    with connect() as conn:
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
    with connect_db() as conn:
        recover(conn)
    try:
        client = Client(CAGELEDGER_REPOSITORY_URL, CAGELEDGER_GITEA_TOKEN)
    except ValueError:
        with connect_db() as conn:
            conn.execute(
                "UPDATE feedback_tasks SET state='blocked',error=? WHERE state!='done'",
                ("共享仓库地址无效，请管理员检查配置",),
            )
        return
    last_poll = 0
    while not _stop.is_set():
        try:
            if _resume.is_set():
                client.auth_blocked = False
                _resume.clear()
            if time.monotonic() - last_poll >= 300:
                with connect_db() as conn:
                    repo.queue_stale(conn)
                last_poll = time.monotonic()
            if run_once(connect_db, client, FEEDBACK_FILES_PATH):
                _stop.wait(0.2)
            else:
                _stop.wait(2)
        except Exception:
            # Do not log request/response bodies or credentials. Retry local transient DB failures.
            _stop.wait(5)
            with connect_db() as conn:
                recover(conn)


def start():
    global _thread
    # Update-check enablement deliberately has no effect on feedback synchronization.
    if not CAGELEDGER_GITEA_TOKEN:
        return
    with _lock:
        if _thread and _thread.is_alive():
            return
        _stop.clear()
        _thread = threading.Thread(target=_run, name="feedback-gitea", daemon=True)
        _thread.start()


def stop():
    _stop.set()


def resume():
    _resume.set()
