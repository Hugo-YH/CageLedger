"""Exact cent arithmetic with a lossless fallback for legacy fractional values."""

from decimal import Decimal, InvalidOperation

MAX_EXACT_CENTS = (1 << 53) - 1
MONEY_COLUMNS = {
    "billing_statements": ("total_amount",),
    "billing_statement_lines": ("amount", "cumulative"),
    "billing_candidate_snapshots": ("total_amount",),
    "reimbursement_records": (
        "current_month_amount",
        "support_amount",
        "payable_amount",
        "paid_amount",
        "unpaid_amount",
        "accumulated_payable",
        "accumulated_paid",
        "accumulated_unpaid",
    ),
    "reimbursement_settlement_obligations": ("payable_amount", "allocated_amount", "outstanding_amount"),
    "reimbursement_claims": ("total_amount", "allocated_amount", "unallocated_amount"),
    "reimbursement_claim_funding_lines": ("reimbursement_amount", "allocated_amount", "unallocated_amount"),
    "reimbursement_allocations": ("amount",),
}


def exact_cents(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        scaled = Decimal(str(value)) * 100
        if not scaled.is_finite() or abs(scaled) >= MAX_EXACT_CENTS or scaled != scaled.to_integral_value():
            return None
        return int(scaled)
    except (InvalidOperation, ValueError, TypeError):
        return None


def money_difference(left, right):
    cents = [exact_cents(value) for value in (left, right)]
    if all(value is not None for value in cents):
        return (cents[0] - cents[1]) / 100
    return round(float(left) - float(right), 2)


def money_sum(values):
    values = list(values)
    cents = [exact_cents(value) for value in values]
    if all(value is not None for value in cents):
        return sum(cents) / 100
    return round(sum(float(value) for value in values), 2)


def cents_sql(expression):
    # Round-trip equality distinguishes actual fractional cents from ordinary
    # binary representations of two-decimal amounts without changing the input.
    return f"""CASE WHEN typeof({expression}) IN ('integer','real')
        AND abs({expression}) < {MAX_EXACT_CENTS} / 100.0
        AND {expression} = ROUND({expression} * 100) / 100.0
        THEN CAST(ROUND({expression} * 100) AS INTEGER) ELSE NULL END"""
