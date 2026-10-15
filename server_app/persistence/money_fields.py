"""Idempotent cent mirrors; legacy yuan columns and JSON remain unchanged."""

from server_app.shared.money_fields import MONEY_COLUMNS, cents_sql


def ensure_schema(conn):
    for table, monetary in MONEY_COLUMNS.items():
        columns = {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')}
        for column in monetary:
            cents = column + "_cents"
            if cents not in columns:
                conn.execute(
                    f'ALTER TABLE "{table}" ADD COLUMN "{cents}" INTEGER '
                    f'CHECK("{cents}" IS NULL OR typeof("{cents}") = \'integer\')'
                )
        assignments = ",".join(f'"{column}_cents" = {cents_sql(column)}' for column in monetary)
        differs = " OR ".join(f'"{column}_cents" IS NOT ({cents_sql(column)})' for column in monetary)
        conn.execute(f'UPDATE "{table}" SET {assignments} WHERE {differs}')
        incoming = ",".join(f'"{column}_cents" = {cents_sql("NEW." + column)}' for column in monetary)
        old_names = ",".join(f'"{column}"' for column in monetary)
        cent_names = ",".join(f'"{column}_cents"' for column in monetary)
        invalid = " OR ".join(f'NEW."{column}_cents" IS NOT ({cents_sql("NEW." + column)})' for column in monetary)
        for kind, event in (("insert", "INSERT"), ("update", f"UPDATE OF {old_names}")):
            conn.execute(f'''CREATE TRIGGER IF NOT EXISTS "money_{table}_{kind}"
                AFTER {event} ON "{table}" BEGIN
                UPDATE "{table}" SET {incoming} WHERE rowid = NEW.rowid; END''')
        conn.execute(f'''CREATE TRIGGER IF NOT EXISTS "money_{table}_check"
            BEFORE UPDATE OF {cent_names} ON "{table}" WHEN {invalid}
            BEGIN SELECT RAISE(ABORT, '金额分字段与元字段不一致'); END''')
