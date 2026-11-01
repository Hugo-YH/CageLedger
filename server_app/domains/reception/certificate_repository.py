"""Independent reception evidence, recognition attempts and confirmed registers."""

import json

RUN_COLUMNS = (
    "id,batch_id,attachment_id,actor_id,request_id,source_batch_version,status,model,"
    "result_json,error_message,created_at,updated_at"
)


def ensure_schema(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS reception_certificate_attachments (
        id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, name TEXT NOT NULL,
        sha256 TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>0), page_count INTEGER NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        preview_sha256 TEXT NOT NULL DEFAULT '', preview_size INTEGER,
        UNIQUE(batch_id,sha256))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS reception_certificate_runs (
        id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, attachment_id TEXT NOT NULL,
        actor_id TEXT NOT NULL, request_id TEXT NOT NULL, source_batch_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
        model TEXT NOT NULL, raw_json TEXT, result_json TEXT, error_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(actor_id,request_id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS reception_registrations (
        id TEXT PRIMARY KEY, batch_id TEXT NOT NULL UNIQUE, updated_at TEXT NOT NULL,
        source_batch_version TEXT NOT NULL, total_quantity INTEGER NOT NULL CHECK(total_quantity>=0),
        payload TEXT NOT NULL)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS reception_registration_requests (
        actor_id TEXT NOT NULL, request_id TEXT NOT NULL, batch_id TEXT NOT NULL,
        signature TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(actor_id,request_id))""")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_reception_run_batch ON reception_certificate_runs(batch_id,attachment_id,created_at DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_reception_run_attachment ON reception_certificate_runs(attachment_id,status)"
    )


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def batch(conn, identity):
    row = conn.execute("SELECT id,updated_at,status,payload FROM intake_batches WHERE id=?", (identity,)).fetchone()
    return dict(row) if row else None


def attachments(conn, batch_id):
    return [
        dict(row)
        for row in conn.execute(
            "SELECT * FROM reception_certificate_attachments WHERE batch_id=? ORDER BY created_at,id", (batch_id,)
        )
    ]


def attachment(conn, batch_id, identity):
    row = conn.execute(
        "SELECT * FROM reception_certificate_attachments WHERE batch_id=? AND id=?", (batch_id, identity)
    ).fetchone()
    return dict(row) if row else None


def identical_attachment(conn, batch_id, digest):
    row = conn.execute(
        "SELECT * FROM reception_certificate_attachments WHERE batch_id=? AND sha256=?", (batch_id, digest)
    ).fetchone()
    return dict(row) if row else None


def insert_attachment(conn, item):
    conn.execute(
        "INSERT INTO reception_certificate_attachments "
        "(id,batch_id,name,sha256,size,page_count,created_by,created_at,preview_sha256,preview_size) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [item[key] for key in ("id", "batch_id", "name", "sha256", "size", "page_count", "created_by", "created_at")]
        + [item.get("preview_sha256", ""), item.get("preview_size")],
    )


def run(conn, identity):
    row = conn.execute(f"SELECT {RUN_COLUMNS} FROM reception_certificate_runs WHERE id=?", (identity,)).fetchone()
    return dict(row) if row else None


def requested_run(conn, actor_id, request_id):
    row = conn.execute(
        f"SELECT {RUN_COLUMNS} FROM reception_certificate_runs WHERE actor_id=? AND request_id=?",
        (actor_id, request_id),
    ).fetchone()
    return dict(row) if row else None


def runs(conn, batch_id):
    rows = conn.execute(
        f"SELECT {RUN_COLUMNS} FROM (SELECT {RUN_COLUMNS},row_number() OVER "
        "(PARTITION BY attachment_id ORDER BY created_at DESC,id DESC) rank "
        "FROM reception_certificate_runs WHERE batch_id=?) WHERE rank=1 ORDER BY created_at DESC,id DESC LIMIT 20",
        (batch_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def runs_by_ids(conn, ids):
    if not ids:
        return {}
    rows = conn.execute(
        f"SELECT {RUN_COLUMNS} FROM reception_certificate_runs WHERE id IN ({','.join('?' for _ in ids)})", ids
    )
    return {row["id"]: dict(row) for row in rows}


def running_runs(conn, attachment_id):
    return conn.execute(
        "SELECT id,created_at FROM reception_certificate_runs WHERE attachment_id=? AND status='running'",
        (attachment_id,),
    ).fetchall()


def insert_run(conn, item):
    conn.execute(
        "INSERT INTO reception_certificate_runs "
        "(id,batch_id,attachment_id,actor_id,request_id,source_batch_version,status,model,created_at,updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
            item[key]
            for key in (
                "id",
                "batch_id",
                "attachment_id",
                "actor_id",
                "request_id",
                "source_batch_version",
                "status",
                "model",
                "created_at",
                "updated_at",
            )
        ],
    )


def finish_run(conn, identity, at, *, result=None, raw=None, error=""):
    conn.execute(
        "UPDATE reception_certificate_runs SET status=?,result_json=?,raw_json=?,error_message=?,updated_at=? "
        "WHERE id=? AND status='running'",
        (
            "failed" if error else "completed",
            encode(result) if result is not None else None,
            encode(raw) if raw is not None else None,
            error,
            at,
            identity,
        ),
    )


def registrations(conn, ids):
    if not ids:
        return {}
    rows = conn.execute(
        f"SELECT batch_id,payload FROM reception_registrations WHERE batch_id IN ({','.join('?' for _ in ids)})", ids
    )
    return {row["batch_id"]: json.loads(row["payload"]) for row in rows}


def registration(conn, batch_id):
    return registrations(conn, [batch_id]).get(batch_id)


def registration_summaries(conn, ids):
    if not ids:
        return {}
    rows = conn.execute(
        f"SELECT batch_id,updated_at,source_batch_version,total_quantity FROM reception_registrations "
        f"WHERE batch_id IN ({','.join('?' for _ in ids)})",
        ids,
    )
    return {
        row["batch_id"]: {
            "updatedAt": row["updated_at"],
            "sourceBatchUpdatedAt": row["source_batch_version"],
            "totalQuantity": row["total_quantity"],
        }
        for row in rows
    }


def attachment_counts(conn, ids):
    if not ids:
        return {}
    return {
        row["batch_id"]: row["count"]
        for row in conn.execute(
            f"SELECT batch_id,count(*) count FROM reception_certificate_attachments "
            f"WHERE batch_id IN ({','.join('?' for _ in ids)}) GROUP BY batch_id",
            ids,
        )
    }


def save_registration(conn, item):
    conn.execute(
        "INSERT INTO reception_registrations VALUES (?,?,?,?,?,?) ON CONFLICT(batch_id) DO UPDATE SET "
        "updated_at=excluded.updated_at,source_batch_version=excluded.source_batch_version,"
        "total_quantity=excluded.total_quantity,payload=excluded.payload",
        (
            item["id"],
            item["batchId"],
            item["updatedAt"],
            item["sourceBatchUpdatedAt"],
            item["totalQuantity"],
            encode(item),
        ),
    )


def saved_request(conn, actor_id, request_id):
    row = conn.execute(
        "SELECT batch_id,signature,result_json FROM reception_registration_requests WHERE actor_id=? AND request_id=?",
        (actor_id, request_id),
    ).fetchone()
    return dict(row) if row else None


def record_request(conn, actor_id, request_id, batch_id, signature, result, at):
    conn.execute(
        "INSERT INTO reception_registration_requests VALUES (?,?,?,?,?,?)",
        (actor_id, request_id, batch_id, signature, encode(result), at),
    )
