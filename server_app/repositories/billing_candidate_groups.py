"""Quantity-sheet source grouping and calculation fingerprints."""


def list_quantity_settlement_groups(conn):
    rows = conn.execute(
        """
        SELECT month, pi, iacuc, id, updated_at
        FROM quantity_sheets
        WHERE TRIM(COALESCE(month, '')) != '' AND TRIM(COALESCE(pi, '')) != ''
        ORDER BY month DESC, pi COLLATE NOCASE, iacuc COLLATE NOCASE, id COLLATE NOCASE
        """
    ).fetchall()
    groups = []
    current = None
    fingerprint_parts = []
    for row in rows:
        month = row["month"] or ""
        pi = row["pi"] or ""
        iacuc = row["iacuc"] or ""
        if not current or current["month"] != month or current["pi"] != pi:
            if current:
                current["sourceFingerprint"] = "|".join([*fingerprint_parts, QUANTITY_SETTLEMENT_CALCULATION_VERSION])
            current = {"month": month, "pi": pi, "iacucs": []}
            groups.append(current)
            fingerprint_parts = []
        if iacuc:
            current["iacucs"].append(iacuc)
        fingerprint_parts.append(f"{row['id'] or ''}:{row['updated_at'] or ''}")
    if current:
        current["sourceFingerprint"] = "|".join([*fingerprint_parts, QUANTITY_SETTLEMENT_CALCULATION_VERSION])
    return groups


def get_quantity_settlement_group(conn, month, pi):
    rows = conn.execute(
        """
        SELECT iacuc, id, updated_at
        FROM quantity_sheets
        WHERE month = ? AND pi = ?
        ORDER BY iacuc COLLATE NOCASE, id COLLATE NOCASE
        """,
        (month, pi),
    ).fetchall()
    if not rows:
        return None
    return quantity_settlement_group_from_rows(month, pi, rows)


def quantity_settlement_group_from_rows(month, pi, rows):
    fingerprint_parts = [f"{row['id'] or ''}:{row['updated_at'] or ''}" for row in rows]
    return {
        "month": month,
        "pi": pi,
        "iacucs": [row["iacuc"] or "" for row in rows if row["iacuc"]],
        "sourceFingerprint": "|".join([*fingerprint_parts, QUANTITY_SETTLEMENT_CALCULATION_VERSION]),
    }


QUANTITY_SETTLEMENT_CALCULATION_VERSION = "2026-08-06-preferred-free-cage-fix"
