def list_quantity_settlement_groups(conn):
    rows = conn.execute(
        """
        SELECT month, pi
        FROM quantity_sheets
        WHERE TRIM(COALESCE(month, '')) != '' AND TRIM(COALESCE(pi, '')) != ''
        GROUP BY month, pi
        ORDER BY month DESC, pi COLLATE NOCASE
        """
    ).fetchall()
    return [{"month": row["month"], "pi": row["pi"]} for row in rows]
