"""Read-only projections for offline billing consistency checks."""

from server_app.shared.money_fields import MONEY_COLUMNS, cents_sql

LEDGER_COLUMNS = {
    "billing_workflows": ("id", "current_version_id", "current_version_no"),
    "billing_statement_versions": ("id", "workflow_id", "version_no", "payload"),
    "reimbursement_settlement_obligations": (
        "id",
        "workflow_id",
        "statement_version_id",
        "statement_version_no",
        "obligation_kind",
        "status",
        "payable_amount",
        "allocated_amount",
        "outstanding_amount",
        "claim_count",
    ),
    "reimbursement_claims": ("id", "total_amount", "allocated_amount", "unallocated_amount"),
    "reimbursement_claim_funding_lines": (
        "id",
        "claim_id",
        "reimbursement_amount",
        "allocated_amount",
        "unallocated_amount",
    ),
    "reimbursement_allocations": ("id", "funding_line_id", "obligation_id", "amount", "status"),
}


def schema_columns(conn):
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    names = (
        set(LEDGER_COLUMNS)
        | set(MONEY_COLUMNS)
        | {
            "reimbursement_records",
            "billing_statement_version_lines",
            "billing_statement_line_blocks",
        }
    )
    return {
        table: {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')} for table in sorted(names & tables)
    }


def ledger_rows(conn):
    return {
        table: {row["id"]: dict(row) for row in conn.execute(f'SELECT {",".join(columns)} FROM "{table}" ORDER BY id')}
        for table, columns in LEDGER_COLUMNS.items()
    }


def confirmed_totals(conn, schema, field):
    cent = "amount_cents" if "amount_cents" in schema["reimbursement_allocations"] else "NULL"
    return {
        row["identity"]: dict(row)
        for row in conn.execute(
            f"""SELECT {field} AS identity,COUNT(*) AS n,COUNT({cent}) AS exact,
                SUM({cent}) AS cents,SUM(amount) AS yuan,COUNT(DISTINCT funding_line_id) AS line_count
                FROM reimbursement_allocations WHERE status='confirmed' GROUP BY {field}"""
        )
    }


def cent_findings(conn, schema):
    missing, fractional, mismatches, invalid = [], [], [], []
    for table, fields in MONEY_COLUMNS.items():
        if table not in schema:
            missing.append(table)
            continue
        for field in fields:
            if field not in schema[table]:
                missing.append(f"{table}.{field}")
                continue
            identity = "id" if "id" in schema[table] else "rowid"
            for row in conn.execute(
                f'''SELECT {identity},"{field}" FROM "{table}"
                    WHERE "{field}" IS NOT NULL AND
                    (typeof("{field}") NOT IN ('integer','real') OR abs("{field}")>1.7976931348623157e308)'''
            ):
                invalid.append((table, str(row[0]), field))
            expected = cents_sql(f'"{field}"')
            fractional.append(
                {
                    "table": table,
                    "field": field,
                    "count": conn.execute(
                        f'SELECT COUNT(*) FROM "{table}" WHERE "{field}" IS NOT NULL AND ({expected}) IS NULL'
                    ).fetchone()[0],
                }
            )
            mirror = field + "_cents"
            if mirror not in schema[table]:
                missing.append(f"{table}.{mirror}")
                continue
            for row in conn.execute(
                f'''SELECT {identity},"{mirror}",({expected}) FROM "{table}"
                    WHERE "{mirror}" IS NOT ({expected}) OR
                    ("{mirror}" IS NOT NULL AND typeof("{mirror}")<>'integer')'''
            ):
                mismatches.append((table, str(row[0]), field, row[1], row[2]))
    return missing, fractional, mismatches, invalid


def legacy_records(conn):
    return conn.execute(
        """SELECT id,payable_amount,paid_amount,unpaid_amount,accumulated_payable,
        accumulated_paid,accumulated_unpaid FROM reimbursement_records ORDER BY id"""
    )
