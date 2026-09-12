import json
import re

from server_app.domains.intake import SPECIES_CODES
from server_app.repositories.payload import dump_json
from server_app.shared import clean_text


def ensure_schema(conn):
    for table, extra in (
        ("batches", ""),
        ("tests", ", batch_id TEXT NOT NULL REFERENCES quarantine_batches(id)"),
        ("attachments", ", test_id TEXT NOT NULL REFERENCES quarantine_tests(id)"),
        (
            "reports",
            ", test_id TEXT NOT NULL REFERENCES quarantine_tests(id), version INTEGER NOT NULL, UNIQUE(test_id, version)",
        ),
    ):
        conn.execute(
            f"CREATE TABLE IF NOT EXISTS quarantine_{table} (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL {extra})"
        )
    for table, field in (("tests", "batch_id"), ("attachments", "test_id"), ("reports", "test_id")):
        conn.execute(f"CREATE INDEX IF NOT EXISTS idx_quarantine_{table}_{field} ON quarantine_{table}({field})")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS quarantine_number_sequences (
               scope TEXT PRIMARY KEY,
               last_value INTEGER NOT NULL
           )"""
    )
    backfill_number_sequences(conn)
    repair_linked_source_species(conn)


def backfill_number_sequences(conn):
    for batch in all_items(conn, "batches"):
        batch_no = clean_text(batch.get("batchNo") or batch.get("name"))
        if match := re.fullmatch(r"B(\d{6})(\d{2})", batch_no):
            advance_sequence(conn, f"batch:{match.group(1)}", int(match.group(2)))
    for report in all_items(conn, "reports"):
        if match := re.fullmatch(r"(B\d{8})([MEP])(\d{6})(\d{2})", clean_text(report.get("number"))):
            advance_sequence(conn, f"report:{match.group(1)}:{match.group(2)}:{match.group(3)}", int(match.group(4)))


def sequence_value(conn, scope):
    row = conn.execute("SELECT last_value FROM quarantine_number_sequences WHERE scope=?", (scope,)).fetchone()
    return int(row[0]) if row else 0


def advance_sequence(conn, scope, value):
    if value <= sequence_value(conn, scope):
        return
    conn.execute(
        """INSERT INTO quarantine_number_sequences(scope, last_value) VALUES (?, ?)
           ON CONFLICT(scope) DO UPDATE SET last_value=MAX(last_value, excluded.last_value)""",
        (scope, value),
    )


def reserve_sequence(conn, scope, value):
    if value <= sequence_value(conn, scope):
        raise ValueError("编号已经分配过且不能重复使用，请刷新后重试")
    advance_sequence(conn, scope, value)


def repair_linked_source_species(conn):
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='intake_batches'").fetchone():
        return
    intake_species = {
        row["id"]: clean_text(json.loads(row["payload"]).get("species"))
        for row in conn.execute("SELECT id, payload FROM intake_batches")
    }
    for row in conn.execute("SELECT id, payload FROM quarantine_batches"):
        payload = json.loads(row["payload"])
        changed = False
        for source in payload.get("sources", []):
            species = intake_species.get(clean_text(source.get("intakeId")))
            if species in SPECIES_CODES and source.get("species") != species:
                source["species"] = species
                changed = True
        if changed:
            conn.execute("UPDATE quarantine_batches SET payload=? WHERE id=?", (dump_json(payload), row["id"]))


def get(conn, table, entity_id):
    row = conn.execute(f"SELECT payload FROM quarantine_{table} WHERE id=?", (entity_id,)).fetchone()
    if not row:
        raise LookupError("检疫记录不存在")
    return json.loads(row[0])


def all_items(conn, table, parent=None):
    field = "batch_id" if table == "tests" else "test_id"
    where, args = (f"WHERE {field}=?", (parent,)) if parent else ("", ())
    if table == "attachments":
        where += (" AND " if where else "WHERE ") + "COALESCE(json_extract(payload, '$.removed'), 0) = 0"
    return [
        json.loads(row[0])
        for row in conn.execute(f"SELECT payload FROM quarantine_{table} {where} ORDER BY updated_at DESC, id", args)
    ]


def save(conn, table, item, *, create=False):
    payload = json.dumps(item, ensure_ascii=False)
    if not create:
        conn.execute(
            f"UPDATE quarantine_{table} SET payload=?, updated_at=? WHERE id=?",
            (payload, item["updatedAt"], item["id"]),
        )
        return
    fields, values = ["id", "payload", "updated_at"], [item["id"], payload, item["updatedAt"]]
    if table == "tests":
        fields.append("batch_id")
        values.append(item["batchId"])
    if table in {"reports", "attachments"}:
        fields.append("test_id")
        values.append(item["testId"])
    if table == "reports":
        fields.append("version")
        values.append(item["version"])
    conn.execute(
        f"INSERT INTO quarantine_{table} ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})", values
    )


def delete(conn, table, entity_id):
    conn.execute(f"DELETE FROM quarantine_{table} WHERE id=?", (entity_id,))


def intake(conn, entity_id):
    row = conn.execute("SELECT payload FROM intake_batches WHERE id=?", (entity_id,)).fetchone()
    if not row:
        raise ValueError("选择的到货批次不存在")
    return json.loads(row[0])


def supplier_options(conn):
    from server_app.domains.intake.strain_standard import abbreviate_supplier

    names = {
        abbreviate_supplier(str(row[0] or ""))
        for row in conn.execute("SELECT DISTINCT json_extract(payload, '$.supplier') FROM intake_batches")
    }
    names.update(s["supplier"] for b in all_items(conn, "batches") for s in b["sources"])
    return sorted(name for name in names if name)


def batch_number_exists(conn, batch_no, exclude_id=""):
    return bool(
        conn.execute(
            """SELECT 1 FROM quarantine_batches
               WHERE lower(COALESCE(json_extract(payload, '$.batchNo'), json_extract(payload, '$.name'))) = lower(?)
                 AND id != ?
               LIMIT 1""",
            (batch_no, exclude_id),
        ).fetchone()
    )


def list_page(conn, table, params):
    limit = min(200, max(1, int(params.get("limit", 30))))
    offset = max(0, int(params.get("offset", 0)))
    if table == "batches":
        source, order = "quarantine_batches", "updated_at DESC, id"
        where = "instr(lower(json_extract(payload, '$.name')), lower(?)) > 0"
        args = [params.get("search", "")]
    else:
        source, order = "intake_batches", "intake_date DESC, id"
        where = "json_extract(payload, '$.status') = 'received' AND (? = '' OR intake_date >= ?) AND (? = '' OR intake_date <= ?)"
        start, end = params.get("dateFrom", ""), params.get("dateTo", "")
        args = [start, start, end, end]
        state = params.get("state", "pending")
        if state == "pending":
            # Build the covered ID set once instead of scanning every source for each intake.
            # Manual sources may omit intakeId; exclude NULL so NOT IN retains uncovered rows.
            where += """ AND id NOT IN (
                SELECT json_extract(s.value, '$.intakeId')
                FROM quarantine_batches q, json_each(q.payload, '$.sources') s
                WHERE json_extract(s.value, '$.intakeId') IS NOT NULL
            )"""
    total = conn.execute(f"SELECT COUNT(*) FROM {source} WHERE {where}", args).fetchone()[0]
    items = [
        json.loads(row[0])
        for row in conn.execute(
            f"SELECT payload FROM {source} WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?", [*args, limit, offset]
        )
    ]
    if table != "batches":
        from .workflow import decorate_intakes

        decorate_intakes(conn, items)
    return {
        "items": items,
        "page": {"limit": limit, "offset": offset, "total": total, "hasMore": offset + limit < total},
    }
