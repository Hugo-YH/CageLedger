"""Authenticated local feedback commands; no network access in transactions."""

import hashlib
import json
import re
from uuid import uuid4

from server_app.config import CAGELEDGER_GITEA_TOKEN, CAGELEDGER_REPOSITORY_URL
from server_app.domains.administration.audit import audit_event, write_audit_events
from server_app.shared import now_iso

from . import repository as repo

KINDS = {"bug", "suggestion", "question"}
STATUSES = {"pending", "in_progress", "verification", "resolved", "closed", "conflict", "deleted"}


def admin(user):
    if user.get("role") != "admin":
        raise PermissionError("仅管理员可管理反馈同步")


def text(value, limit, required=False):
    if not isinstance(value, str) or len(value) > limit or "\x00" in value:
        raise ValueError("反馈字段格式或长度无效")
    value = value.strip()
    if required and not value:
        raise ValueError("请填写必填内容")
    return value


def request_id(body):
    value = text(body.get("requestId", ""), 100, True)
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,100}", value):
        raise ValueError("请求标识无效")
    return value


def digest(value):
    return hashlib.sha256(repo.encode(value).encode()).hexdigest()


def author(user):
    return {"id": user["id"], "name": user.get("displayName") or user.get("username", "")}


def audit(conn, user, action, feedback_id, before=None, after=None):
    write_audit_events(
        conn,
        [
            audit_event(
                user, f"feedback.{action}", "feedback", feedback_id, "帮助与反馈操作", [], now_iso(), before, after
            )
        ],
    )


def present(conn, row, user, metadata=None):
    require_active(row)
    if metadata is None:
        state, error = repo.sync_state(conn, row["id"], bool(CAGELEDGER_GITEA_TOKEN))
        counts = conn.execute(
            "SELECT COUNT(*) total, COALESCE(MAX(actor_id=?),0) encountered FROM feedback_encounters WHERE feedback_id=?",
            (user["id"], row["id"]),
        ).fetchone()
    else:
        (state, error), counts = metadata
    return {
        "id": row["id"],
        "number": row["number"],
        "title": row["title"],
        "kind": row["kind"],
        "module": row["module"],
        "description": row["description"],
        "status": row["status"],
        "syncStatus": state,
        "createdBy": json.loads(row["author"]),
        "environment": json.loads(row["environment"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "version": row["version"],
        "source": row["source"],
        "importMetadata": json.loads(row["import_metadata"]),
        "encounterCount": counts["total"],
        "encountered": bool(counts["encountered"]),
        "assignees": json.loads(row["assignees"]),
        "fixVersion": row["fix_version"],
        "lastSyncedAt": row["last_synced_at"],
        "issueNumber": row["issue_number"],
        "issueUrl": row["issue_url"] if user.get("role") == "admin" else "",
        "syncError": error if user.get("role") == "admin" else "",
    }


def list_page(conn, user, params):
    page = repo.list_page(conn, user, params, bool(CAGELEDGER_GITEA_TOKEN))
    metadata = repo.page_metadata(conn, page["items"], user["id"], bool(CAGELEDGER_GITEA_TOKEN))
    return {**page, "items": [present(conn, row, user, metadata[row["id"]]) for row in page["items"]]}


def filter_options(conn, user, params):
    return repo.filter_options(conn, user, params, bool(CAGELEDGER_GITEA_TOKEN))


def attachment(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "mime": row["mime"],
        "size": row["size"],
        "url": "/api/feedback/attachments/" + row["id"],
    }


def comment(conn, row):
    attachments = conn.execute(
        "SELECT * FROM feedback_attachments WHERE comment_id=? AND visible=1", (row["id"],)
    ).fetchall()
    return {
        "id": row["id"],
        "body": row["remote_body"] if row["remote_body"] is not None else row["body"],
        "author": json.loads(row["author"]),
        "source": row["source"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "attachments": [attachment(item) for item in attachments],
    }


def detail(conn, user, feedback_id):
    row = repo.get(conn, feedback_id)
    require_active(row)
    comments = conn.execute(
        "SELECT * FROM feedback_comments WHERE feedback_id=? AND visible=1 ORDER BY created_at,id", (feedback_id,)
    ).fetchall()
    attachments = conn.execute(
        "SELECT * FROM feedback_attachments WHERE feedback_id=? AND comment_id IS NULL AND visible=1", (feedback_id,)
    ).fetchall()
    queue_refresh(conn, feedback_id)
    return {
        "item": present(conn, row, user),
        "comments": [comment(conn, item) for item in comments],
        "attachments": [attachment(item) for item in attachments],
    }


def create(conn, user, body):
    identity = request_id(body)
    kind = body.get("kind")
    if kind not in KINDS:
        raise ValueError("请选择反馈类型")
    raw_environment = body.get("environment", {})
    if not isinstance(raw_environment, dict):
        raise ValueError("环境信息格式无效")
    environment = {key: text(raw_environment.get(key, ""), 500) for key in ("appVersion", "build", "page", "browser")}
    # Never persist URLs or their query strings from the client context.
    if any("://" in environment[key] or "?" in environment[key] for key in ("page", "browser")):
        raise ValueError("环境信息不能包含网址或查询参数")
    content = {
        "title": text(body.get("title", ""), 200, True),
        "kind": kind,
        "module": text(body.get("module", ""), 100, True),
        "description": text(body.get("description", ""), 20000, True),
        "environment": environment,
    }
    signature = digest(content)
    conn.execute("BEGIN IMMEDIATE")
    existing = conn.execute(
        "SELECT * FROM feedback WHERE actor_id=? AND request_id=?", (user["id"], identity)
    ).fetchone()
    if existing:
        if existing["request_hash"] != signature:
            raise ValueError("同一请求标识不能用于不同反馈")
        return present(conn, existing, user)
    feedback_id, at = str(uuid4()), now_iso()
    conn.execute(
        """INSERT INTO feedback(id,actor_id,request_id,request_hash,title,kind,module,description,author,
           environment,created_at,updated_at,repository) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            feedback_id,
            user["id"],
            identity,
            signature,
            content["title"],
            kind,
            content["module"],
            content["description"],
            repo.encode(author(user)),
            repo.encode(environment),
            at,
            at,
            CAGELEDGER_REPOSITORY_URL.rstrip("/").removesuffix(".git"),
        ),
    )
    repo.enqueue(conn, feedback_id, "create")
    audit(conn, user, "created", feedback_id, after=content)
    return present(conn, repo.get(conn, feedback_id), user)


def require_active(row):
    if row["status"] == "deleted":
        raise LookupError("反馈已删除")


def supplement(conn, user, feedback_id, body):
    identity, message = request_id(body), text(body.get("body", ""), 20000, True)
    if message.startswith("【内部】"):
        raise ValueError("系统内补充公开展示，请勿使用内部评论标记")
    signature = digest(message)
    conn.execute("BEGIN IMMEDIATE")
    require_active(repo.get(conn, feedback_id))
    row = conn.execute(
        "SELECT * FROM feedback_comments WHERE feedback_id=? AND actor_id=? AND request_id=?",
        (feedback_id, user["id"], identity),
    ).fetchone()
    if row:
        if row["request_hash"] != signature:
            raise ValueError("同一请求标识不能用于不同补充")
        return comment(conn, row)
    comment_id, at = str(uuid4()), now_iso()
    conn.execute(
        """INSERT INTO feedback_comments(id,feedback_id,actor_id,request_id,request_hash,body,author,source,
           created_at,updated_at) VALUES(?,?,?,?,?,?,?,'local',?,?)""",
        (comment_id, feedback_id, user["id"], identity, signature, message, repo.encode(author(user)), at, at),
    )
    repo.enqueue(conn, feedback_id, "comment", comment_id)
    conn.execute("UPDATE feedback SET updated_at=?,version=version+1 WHERE id=?", (at, feedback_id))
    audit(conn, user, "supplemented", feedback_id, after={"commentId": comment_id, "body": message})
    return comment(conn, conn.execute("SELECT * FROM feedback_comments WHERE id=?", (comment_id,)).fetchone())


def encounter(conn, user, feedback_id, body):
    selected = body.get("encountered")
    if not isinstance(selected, bool):
        raise ValueError("遇到状态必须是布尔值")
    conn.execute("BEGIN IMMEDIATE")
    repo.get(conn, feedback_id)
    require_active(repo.get(conn, feedback_id))
    if selected:
        changed = conn.execute(
            "INSERT OR IGNORE INTO feedback_encounters VALUES(?,?,?)", (feedback_id, user["id"], now_iso())
        ).rowcount
    else:
        changed = conn.execute(
            "DELETE FROM feedback_encounters WHERE feedback_id=? AND actor_id=?", (feedback_id, user["id"])
        ).rowcount
    if changed:
        repo.enqueue(conn, feedback_id, "encounters")
        audit(conn, user, "encountered", feedback_id, after={"encountered": selected})
    return present(conn, repo.get(conn, feedback_id), user)


def queue_refresh(conn, feedback_id):
    import time
    from datetime import datetime

    row = repo.get(conn, feedback_id)
    require_active(row)
    if not row["issue_number"]:
        return {"queued": False}
    try:
        at = datetime.fromisoformat(row["last_synced_at"]).timestamp()
    except ValueError:
        at = 0
    task = conn.execute(
        "SELECT state FROM feedback_tasks WHERE kind='refresh' AND entity_id=?", (feedback_id,)
    ).fetchone()
    if time.time() - at > 60 and (not task or task["state"] in {"done", "blocked"}):
        repo.enqueue(conn, feedback_id, "refresh")
        return {"queued": True}
    return {"queued": False}


def retry(conn, user, feedback_id):
    from . import worker

    admin(user)
    conn.execute("BEGIN IMMEDIATE")
    require_active(repo.get(conn, feedback_id))
    conn.execute(
        "UPDATE feedback_tasks SET state='pending',due_at=0,error='' WHERE feedback_id=? AND state NOT IN ('done','working')",
        (feedback_id,),
    )
    audit(conn, user, "retry", feedback_id)
    worker.resume()
    return {"queued": True}


def integration(conn, user):
    admin(user)
    pending = conn.execute("SELECT COUNT(*) FROM feedback_tasks WHERE state!='done'").fetchone()[0]
    errors = conn.execute("SELECT COUNT(*) FROM feedback_tasks WHERE error!=''").fetchone()[0]
    row = conn.execute("SELECT error FROM feedback_tasks WHERE error!='' ORDER BY id DESC LIMIT 1").fetchone()
    return {
        "configured": bool(CAGELEDGER_GITEA_TOKEN),
        "repository": CAGELEDGER_REPOSITORY_URL,
        "pending": pending,
        "errors": errors,
        "lastError": row[0] if row else "",
    }
