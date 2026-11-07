"""Streaming dashboard projections; original JSON remains the source of truth."""

import json

INTAKE_FIELDS = ("intakeDate", "quantity", "strainStandard", "strainRaw", "species")


def intake_statistics_rows(conn, start=None, end=None):
    where = "WHERE intake_date >= ? AND intake_date < ?" if start is not None else ""
    order = "intake_date" if start is not None else "COALESCE(intake_date, '')"
    # Multi-path extraction preserves JSON types and numeric text. Legacy root
    # shapes/duplicate statistic keys use Python's original last-key semantics.
    query = f"""SELECT CASE WHEN json_valid(payload) THEN
        CASE WHEN json_type(payload)='object' AND NOT EXISTS (
            SELECT 1 FROM json_each(payload)
            WHERE key IN ('intakeDate','quantity','strainStandard','strainRaw','species')
            GROUP BY key HAVING COUNT(*)>1
        ) THEN json_object('fields',json_extract(payload,
            '$.intakeDate','$.quantity','$.strainStandard','$.strainRaw','$.species'))
        ELSE CASE WHEN typeof(payload)='blob' THEN json_object('bytes',hex(payload))
            ELSE json_object('raw',payload) END END
        ELSE CASE WHEN typeof(payload)='blob' THEN json_object('bytes',hex(payload))
            ELSE json_object('raw',payload) END END
        FROM intake_batches {where} ORDER BY {order}"""
    for row in conn.execute(query, (start, end) if start is not None else ()):
        value = json.loads(row[0])
        if "fields" in value:
            yield dict(zip(INTAKE_FIELDS, value["fields"], strict=True))
        else:
            yield json.loads(bytes.fromhex(value["bytes"]) if "bytes" in value else value["raw"])
