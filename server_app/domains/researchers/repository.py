"""Researcher directory persistence; never creates login accounts or business records."""

import json


def ensure_schema(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS researchers (
        id TEXT PRIMARY KEY, account_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL, department TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL, payload TEXT NOT NULL)""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_researchers_name ON researchers(name,id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_researchers_department ON researchers(department,name,id)")
    conn.execute("""CREATE TABLE IF NOT EXISTS researcher_imports (
        actor_id TEXT NOT NULL, request_id TEXT NOT NULL, signature TEXT NOT NULL,
        result TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(actor_id,request_id))""")


def by_account(conn):
    return {row[0]: json.loads(row[1]) for row in conn.execute("SELECT account_key,payload FROM researchers")}


def get(conn, researcher_id):
    row = conn.execute("SELECT payload FROM researchers WHERE id=?", (researcher_id,)).fetchone()
    if row is None:
        raise LookupError("实验人员不存在")
    return json.loads(row[0])


def contact_candidates(conn, names):
    """Exact name/alias candidates in one read; duplicate names remain ambiguous."""
    placeholders = ",".join("?" for _ in names)
    rows = conn.execute(
        f"""SELECT payload FROM researchers WHERE name IN ({placeholders})
            OR json_extract(payload,'$.alias') IN ({placeholders}) ORDER BY id""",
        (*names, *names),
    )
    return [json.loads(row[0]) for row in rows]


def put(conn, item):
    conn.execute(
        """INSERT INTO researchers(id,account_key,name,department,updated_at,payload) VALUES(?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name,department=excluded.department,
             updated_at=excluded.updated_at,payload=excluded.payload""",
        (
            item["id"],
            item["account"].casefold(),
            item["name"],
            item["department"],
            item["updatedAt"],
            json.dumps(item, ensure_ascii=False, separators=(",", ":")),
        ),
    )


def list_items(conn, params):
    try:
        limit, offset = int(params.get("limit", 50)), int(params.get("offset", 0))
    except (ValueError, TypeError) as exc:
        raise ValueError("分页参数无效") from exc
    if not 1 <= limit <= 200 or offset < 0:
        raise ValueError("每页须为1至200条，偏移量不能为负数")
    q, department = params.get("q", "").strip(), params.get("department", "").strip()
    if len(q) > 200 or len(department) > 1000:
        raise ValueError("检索条件过长")
    clauses, values = [], []
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        fields = ("name", "account", "alias", "mobile", "telephone", "email", "enterpriseEmail", "englishName")
        clauses.append(
            "(" + " OR ".join(f"json_extract(payload,'$.{field}') LIKE ? ESCAPE '\\'" for field in fields) + ")"
        )
        values.extend([f"%{escaped}%"] * len(fields))
    if department:
        clauses.append("department=?")
        values.append(department)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    total = conn.execute("SELECT count(*) FROM researchers" + where, values).fetchone()[0]
    rows = conn.execute(
        "SELECT payload FROM researchers" + where + " ORDER BY name,account_key,id LIMIT ? OFFSET ?",
        (*values, limit, offset),
    )
    return {
        "items": [json.loads(row[0]) for row in rows],
        "page": {"limit": limit, "offset": offset, "total": total},
        "departments": [
            row[0]
            for row in conn.execute(
                "SELECT DISTINCT department FROM researchers WHERE department!='' ORDER BY department"
            )
        ],
    }


def import_result(conn, actor_id, request_id):
    row = conn.execute(
        "SELECT signature,result FROM researcher_imports WHERE actor_id=? AND request_id=?", (actor_id, request_id)
    ).fetchone()
    return (row[0], json.loads(row[1])) if row else None


def record_import(conn, actor_id, request_id, signature, result, at):
    conn.execute(
        "INSERT INTO researcher_imports(actor_id,request_id,signature,result,created_at) VALUES(?,?,?,?,?)",
        (actor_id, request_id, signature, json.dumps(result, ensure_ascii=False), at),
    )
