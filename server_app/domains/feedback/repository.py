"""Feedback persistence. Schema upgrades are additive and idempotent."""

import json
import time


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def ensure_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS feedback (
            number INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
            actor_id TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
            title TEXT NOT NULL, kind TEXT NOT NULL, module TEXT NOT NULL,
            description TEXT NOT NULL, author TEXT NOT NULL, environment TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'pending', repository TEXT NOT NULL,
            issue_number INTEGER, issue_url TEXT NOT NULL DEFAULT '',
            assignees TEXT NOT NULL DEFAULT '[]', fix_version TEXT NOT NULL DEFAULT '',
            last_synced_at TEXT NOT NULL DEFAULT '',
            UNIQUE(actor_id, request_id)
        );
        CREATE INDEX IF NOT EXISTS feedback_list ON feedback(created_at DESC, number DESC);
        CREATE TABLE IF NOT EXISTS feedback_comments (
            id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL REFERENCES feedback(id),
            actor_id TEXT NOT NULL DEFAULT '', request_id TEXT, request_hash TEXT,
            body TEXT NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, remote_id INTEGER,
            visible INTEGER NOT NULL DEFAULT 1, remote_body TEXT,
            UNIQUE(feedback_id, actor_id, request_id), UNIQUE(feedback_id, remote_id)
        );
        CREATE TABLE IF NOT EXISTS feedback_encounters (
            feedback_id TEXT NOT NULL REFERENCES feedback(id), actor_id TEXT NOT NULL,
            created_at TEXT NOT NULL, PRIMARY KEY(feedback_id, actor_id)
        );
        CREATE TABLE IF NOT EXISTS feedback_attachments (
            id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL REFERENCES feedback(id),
            comment_id TEXT REFERENCES feedback_comments(id), actor_id TEXT NOT NULL,
            request_id TEXT NOT NULL, request_hash TEXT NOT NULL, name TEXT NOT NULL,
            mime TEXT NOT NULL, size INTEGER NOT NULL, storage_name TEXT NOT NULL,
            remote_id INTEGER, remote_url TEXT NOT NULL DEFAULT '', visible INTEGER NOT NULL DEFAULT 1,
            source TEXT NOT NULL DEFAULT 'local',
            created_at TEXT NOT NULL, UNIQUE(actor_id, request_id)
        );
        CREATE TABLE IF NOT EXISTS feedback_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            feedback_id TEXT NOT NULL REFERENCES feedback(id), kind TEXT NOT NULL,
            entity_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
            generation INTEGER NOT NULL DEFAULT 1, attempts INTEGER NOT NULL DEFAULT 0,
            due_at REAL NOT NULL DEFAULT 0, started_at REAL NOT NULL DEFAULT 0,
            uncertain INTEGER NOT NULL DEFAULT 0, remote_id INTEGER,
            error TEXT NOT NULL DEFAULT '', UNIQUE(kind, entity_id)
        );
        CREATE INDEX IF NOT EXISTS feedback_tasks_ready ON feedback_tasks(state, due_at);
        CREATE INDEX IF NOT EXISTS feedback_tasks_feedback ON feedback_tasks(feedback_id, state);
        CREATE INDEX IF NOT EXISTS feedback_remote ON feedback(repository, issue_number);
        CREATE TABLE IF NOT EXISTS feedback_import_requests (
            actor_id TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
            results TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
            PRIMARY KEY(actor_id, request_id)
        );
    """)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(feedback)")}
    for name, definition in {
        "source": "TEXT NOT NULL DEFAULT 'local'",
        "import_metadata": "TEXT NOT NULL DEFAULT '{}'",
    }.items():
        if name not in columns:
            conn.execute(f"ALTER TABLE feedback ADD COLUMN {name} {definition}")


def get(conn, feedback_id):
    row = conn.execute("SELECT * FROM feedback WHERE id=?", (feedback_id,)).fetchone()
    if not row:
        raise LookupError("反馈不存在")
    return dict(row)


def linked_issue(conn, repository, number):
    return conn.execute(
        "SELECT id,status FROM feedback WHERE repository=? AND issue_number=? ORDER BY number LIMIT 1",
        (repository, number),
    ).fetchone()


def import_request(conn, actor_id, request_id):
    return conn.execute(
        "SELECT * FROM feedback_import_requests WHERE actor_id=? AND request_id=?", (actor_id, request_id)
    ).fetchone()


def create_import_request(conn, actor_id, request_id, signature, at):
    conn.execute(
        "INSERT INTO feedback_import_requests(actor_id,request_id,request_hash,created_at) VALUES(?,?,?,?)",
        (actor_id, request_id, signature, at),
    )


def merge_import_result(conn, actor_id, request_id, number, result):
    stored = json.loads(import_request(conn, actor_id, request_id)["results"])
    stored.setdefault(str(number), result)
    conn.execute(
        "UPDATE feedback_import_requests SET results=? WHERE actor_id=? AND request_id=?",
        (encode(stored), actor_id, request_id),
    )
    return stored


def insert_imported(conn, values):
    conn.execute(
        """INSERT INTO feedback(id,actor_id,request_id,request_hash,title,kind,module,description,author,environment,
        created_at,updated_at,repository,issue_number,issue_url,source,import_metadata)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'gitea',?)""",
        values,
    )


def enqueue(conn, feedback_id, kind, entity_id=None):
    if get(conn, feedback_id)["status"] == "deleted":
        return
    conn.execute(
        """INSERT INTO feedback_tasks(feedback_id,kind,entity_id) VALUES(?,?,?)
        ON CONFLICT(kind,entity_id) DO UPDATE SET
          generation=generation+1, state=CASE WHEN state='working' THEN state ELSE 'pending' END,
          due_at=0, error=''""",
        (feedback_id, kind, entity_id or feedback_id),
    )


def sync_state(conn, feedback_id, configured=True):
    if get(conn, feedback_id)["status"] == "deleted":
        return "removed", ""
    tasks = conn.execute(
        "SELECT state,uncertain,error FROM feedback_tasks WHERE feedback_id=? AND state!='done' ORDER BY id",
        (feedback_id,),
    ).fetchall()
    return task_sync_state(tasks, configured)


def task_sync_state(tasks, configured=True):
    if not tasks:
        return "synced", ""
    if not configured:
        return "unconfigured", "未配置共享 Gitea Token，反馈已留档"
    for row in tasks:
        if row["state"] == "blocked":
            return "uncertain" if row["uncertain"] else "error", row["error"]
    failed = next((row for row in tasks if row["error"]), None)
    return ("error", failed["error"]) if failed else ("pending", "")


def page_metadata(conn, rows, actor_id, configured):
    if not rows:
        return {}
    ids = [row["id"] for row in rows]
    placeholders = ",".join("?" for _ in ids)
    tasks = {feedback_id: [] for feedback_id in ids}
    statuses = {}
    for row in conn.execute(
        "SELECT f.id feedback_id,f.status feedback_status,t.id task_id,t.state,t.uncertain,t.error "
        "FROM feedback f LEFT JOIN feedback_tasks t ON t.feedback_id=f.id AND t.state!='done' "
        f"WHERE f.id IN ({placeholders}) ORDER BY t.id",
        ids,
    ):
        statuses[row["feedback_id"]] = row["feedback_status"]
        if row["task_id"] is not None:
            tasks[row["feedback_id"]].append(row)
    if len(statuses) != len(ids):
        raise LookupError("反馈不存在")
    counts = {
        row["feedback_id"]: row
        for row in conn.execute(
            f"SELECT feedback_id,COUNT(*) total,MAX(actor_id=?) encountered FROM feedback_encounters "
            f"WHERE feedback_id IN ({placeholders}) GROUP BY feedback_id",
            [actor_id, *ids],
        )
    }
    return {
        feedback_id: (
            ("removed", "") if statuses[feedback_id] == "deleted" else task_sync_state(tasks[feedback_id], configured),
            counts.get(feedback_id, {"total": 0, "encountered": 0}),
        )
        for feedback_id in ids
    }


def queue_stale(conn, age=300):
    from datetime import datetime

    for row in conn.execute(
        "SELECT id,last_synced_at FROM feedback WHERE issue_number IS NOT NULL AND status!='deleted'"
    ).fetchall():
        try:
            at = datetime.fromisoformat(row["last_synced_at"]).timestamp()
        except ValueError:
            at = 0
        if time.time() - at >= age:
            existing = conn.execute(
                "SELECT state FROM feedback_tasks WHERE kind='refresh' AND entity_id=?", (row["id"],)
            ).fetchone()
            if not existing or existing["state"] in {"done", "blocked"}:
                enqueue(conn, row["id"], "refresh")


def list_columns(configured):
    # Match sync_state's precedence, including the first blocked task's uncertainty flag.
    sync_status = f"""CASE
        WHEN NOT EXISTS(SELECT 1 FROM feedback_tasks t WHERE t.feedback_id=f.id AND t.state!='done') THEN 'synced'
        WHEN {int(not configured)} THEN 'unconfigured'
        WHEN EXISTS(SELECT 1 FROM feedback_tasks t WHERE t.feedback_id=f.id AND t.state='blocked')
          THEN CASE WHEN (SELECT uncertain FROM feedback_tasks t WHERE t.feedback_id=f.id AND t.state='blocked' ORDER BY id LIMIT 1)
                    THEN 'uncertain' ELSE 'error' END
        WHEN EXISTS(SELECT 1 FROM feedback_tasks t WHERE t.feedback_id=f.id AND t.state!='done' AND t.error!='') THEN 'error'
        ELSE 'pending' END"""
    return {
        "number": "f.number",
        "title": "f.title",
        "kind": "f.kind",
        "module": "f.module",
        "status": "f.status",
        "author": "f.actor_id",
        "syncStatus": sync_status,
        "encounterCount": "(SELECT COUNT(*) FROM feedback_encounters e WHERE e.feedback_id=f.id)",
        "createdAt": "f.created_at",
    }


def column_filters(params, columns):
    try:
        filters = json.loads(params.get("columnFilters", "{}"))
    except (TypeError, ValueError) as exc:
        raise ValueError("反馈筛选格式无效") from exc
    if not isinstance(filters, dict) or any(key not in columns for key in filters):
        raise ValueError("反馈筛选列无效")
    for values in filters.values():
        if (
            not isinstance(values, list)
            or len(values) > 100
            or any(not isinstance(value, str) or len(value) > 500 for value in values)
        ):
            raise ValueError("反馈筛选值无效")
    return filters


def list_where(params, user, columns, exclude=None):
    where, args = ["f.status!='deleted'"], []
    # Retain the original API query parameters for existing clients.
    for column in ("kind", "module", "status"):
        if value := params.get(column):
            where.append(f"f.{column}=?")
            args.append(value)
    if params.get("mine") == "1":
        where.append("f.actor_id=?")
        args.append(user["id"])
    if keyword := params.get("keyword", "").strip():
        where.append("(f.title LIKE ? ESCAPE '\\' OR f.description LIKE ? ESCAPE '\\')")
        pattern = "%" + keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        args.extend([pattern, pattern])
    for column, values in column_filters(params, columns).items():
        if column != exclude and values:
            where.append(f"CAST({columns[column]} AS TEXT) IN ({','.join('?' for _ in values)})")
            args.extend(values)
    return " WHERE " + " AND ".join(where), args


def list_page(conn, user, params, configured):
    limit = min(max(int(params.get("limit", 20)), 1), 100)
    offset = max(int(params.get("offset", 0)), 0)
    columns = list_columns(configured)
    clause, args = list_where(params, user, columns)
    sort = params.get("sortKey", "number")
    direction = params.get("sortDir", "desc")
    if sort not in columns or direction not in {"asc", "desc"}:
        raise ValueError("反馈排序无效")
    expression = "json_extract(f.author,'$.name')" if sort == "author" else columns[sort]
    total = conn.execute("SELECT COUNT(*) FROM feedback f" + clause, args).fetchone()[0]
    rows = conn.execute(
        "SELECT f.* FROM feedback f" + clause + f" ORDER BY {expression} {direction},f.number DESC LIMIT ? OFFSET ?",
        [*args, limit, offset],
    ).fetchall()
    return {"items": rows, "total": total, "limit": limit, "offset": offset}


def filter_options(conn, user, params, configured):
    columns = list_columns(configured)
    column = params.get("column")
    if column not in columns:
        raise ValueError("反馈筛选列无效")
    clause, args = list_where(params, user, columns, exclude=column)
    value = columns[column]
    label = "json_extract(f.author,'$.name')" if column == "author" else f"CAST({value} AS TEXT)"
    rows = conn.execute(
        f"SELECT CAST({value} AS TEXT) value,{label} label,COUNT(*) count FROM feedback f"
        + clause
        + " GROUP BY value ORDER BY label",
        args,
    ).fetchall()
    return {"items": [dict(row) for row in rows]}
