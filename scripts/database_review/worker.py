"""Subprocess entry point: load one code revision against one private database."""

import argparse
import json
import os
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database_review.exports import calculations, stored_bills  # noqa: E402
from database_review.http_checks import audit_payloads, check_http, plaintext_audit_facts  # noqa: E402
from database_review.storage import digest, original_records, quote, require_original_rows, write_json  # noqa: E402


def check(request):
    code, database, runtime = (Path(request[key]).resolve() for key in ("code", "database", "runtime"))
    sys.path.insert(0, str(code))
    # Validate paths again in the child; never inherit an application DB setting.
    from server_app.config import DATA_ROOT, DB_PATH
    from server_app.db import ensure_database_ready
    from server_app.domains.data_quality.detection import detect
    from server_app.domains.reimbursement_ledger.consistency import check_consistency
    from server_app.legacy import initialize_schema
    from server_app.pdf.documents import quantity_sheet_html
    from server_app.repositories.quantity_sheets import list_quantity_sheets

    if DB_PATH.resolve() != database or DATA_ROOT.resolve() != runtime or runtime not in database.parents:
        raise ValueError("核查进程路径隔离失效")
    del initialize_schema  # Import configures the real application's schema initializer.
    scope = request["scope"]
    with closing(sqlite3.connect(database)) as conn:
        conn.row_factory = sqlite3.Row
        original_ids = {
            table: [row[0] for row in conn.execute(f"SELECT id FROM {quote(table)}")]
            for table, spec in scope.items()
            if "id" in spec["columns"]
        }
        source_audits = (
            plaintext_audit_facts(conn.execute("SELECT id,payload FROM audit_events"))
            if "audit_events" in scope
            else {}
        )
    ensure_database_ready()
    print(json.dumps({"stage": "initialized", "case": request["case"]}), flush=True)
    with closing(sqlite3.connect(database)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        if (
            conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok"
            or conn.execute("PRAGMA foreign_key_check").fetchall()
        ):
            raise ValueError("SQLite完整性或外键检查失败")
        migrated = original_records(conn, scope)
        require_original_rows(migrated, scope)
        audits = audit_payloads(conn)
        audit_facts = {identity: digest(audits[identity]) for identity in original_ids.get("audit_events", [])}
        if any(audit_facts.get(identity) != value for identity, value in source_audits.items()):
            raise ValueError("原有审计全文在初始化或兼容解码后发生变化")
        result = {"migration": migrated, "auditFacts": audit_facts, "auditReadableCount": len(audits)}
        result["bills"] = stored_bills(conn, request["pdfSamples"])
        print(json.dumps({"stage": "exports", "case": request["case"], **result["bills"]["coverage"]}), flush=True)
        result["calculations"] = calculations(conn)
        result["quantityHtml"] = {
            sheet["id"]: digest(quantity_sheet_html(sheet)) for sheet in list_quantity_sheets(conn)
        }
        if original_records(conn, scope) != migrated:
            raise ValueError("非持久化计算或导出改变了原有记录")
        result["http"] = check_http(conn, original_ids, request["fixturePrefix"])
        result["afterReads"] = original_records(conn, scope, synchronized=result["http"]["synchronizedIds"])
        require_original_rows(result["afterReads"], scope)
        after_audits = audit_payloads(conn)
        result["auditReadableAfterReads"] = len(after_audits)
        if audit_facts != {identity: digest(after_audits[identity]) for identity in audit_facts}:
            raise ValueError("HTTP核查改写了原有审计正文")
        result["consistency"] = check_consistency(conn)
        if result["consistency"]["summary"]["errors"] or result["consistency"]["summary"]["incomplete"]:
            raise ValueError("读取同步后仍有账务一致性错误或核查不完整")
        result["historicalFindings"] = detect(conn)["summary"]
        if (
            conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok"
            or conn.execute("PRAGMA foreign_key_check").fetchall()
        ):
            raise ValueError("HTTP核查后SQLite完整性或外键检查失败")
        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("request", type=Path)
    args = parser.parse_args()
    request = json.loads(args.request.read_text())
    os.umask(0o077)
    try:
        result = {"completed": True, "checks": check(request)}
    except Exception as exc:  # noqa: BLE001 - keep private evidence for failed reviews.
        result = {"completed": False, "errorType": type(exc).__name__, "error": str(exc)}
    write_json(request["result"], result)
    return 0 if result["completed"] else 1


if __name__ == "__main__":
    sys.exit(main())
