"""Integer-cent SQL for confirmed allocations, retaining legacy fallback paths."""

import math


def confirmed_total(conn, field, identity):
    row = conn.execute(
        f"""SELECT COUNT(*) AS n,COUNT(amount_cents) AS exact,
        SUM(amount_cents) AS cents,SUM(amount) AS yuan FROM reimbursement_allocations
        WHERE {field}=? AND status='confirmed'""",
        (identity,),
    ).fetchone()
    if row[0] == row[1]:
        return (row[2] or 0) / 100
    number = float(row[3] or 0)
    return round(number, 2) if math.isfinite(number) else 0.0


def allocation_fits_sql(field, table, limit_column):
    return f"""CASE WHEN target.amount_cents IS NOT NULL
        AND (SELECT {limit_column}_cents FROM {table} WHERE id=target.{field}) IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM reimbursement_allocations AS pending_legacy
            WHERE pending_legacy.{field}=target.{field} AND status='confirmed' AND amount_cents IS NULL)
        THEN target.amount_cents + (SELECT COALESCE(SUM(other.amount_cents),0)
            FROM reimbursement_allocations AS other WHERE other.{field}=target.{field} AND other.status='confirmed')
            <= (SELECT {limit_column}_cents FROM {table} WHERE id=target.{field})
        ELSE target.amount + (SELECT COALESCE(SUM(other.amount),0)
            FROM reimbursement_allocations AS other WHERE other.{field}=target.{field} AND other.status='confirmed')
            <= (SELECT {limit_column} FROM {table} WHERE id=target.{field}) END"""
