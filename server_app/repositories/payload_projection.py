"""Small original-payload projections, retaining Python's legacy JSON semantics."""

import json
import re
import time
from contextlib import closing

from server_app.performance import record_stage


def projected_rows(conn, table, fields, *, order="rowid"):
    # These identifiers/expressions belong to repository callers, never HTTP input.
    if not re.fullmatch(r"[a-z_]+", table) or any(not re.fullmatch(r"[A-Za-z]+", f) for f in fields):
        raise ValueError("Invalid projection")
    paths = ",".join(f"'$.{field}'" for field in (*fields, fields[0]))
    names = ",".join(f"'{field}'" for field in fields)
    query = f"""SELECT rowid, CASE WHEN typeof(payload)='text' AND json_valid(payload) THEN
      CASE WHEN json_type(payload)='object' AND NOT EXISTS (
        SELECT 1 FROM json_each(payload) WHERE key IN ({names}) GROUP BY key HAVING COUNT(*)>1
      ) THEN json_object('fields',json_extract(payload,{paths})) ELSE json_object('raw',payload) END
      ELSE CASE WHEN typeof(payload)='blob' THEN json_object('bytes',hex(payload))
        ELSE json_object('raw',payload) END END FROM {table} ORDER BY {order}"""
    decode_ms, decoded = 0.0, 0
    cursor = conn.execute(query)
    try:
        for row in cursor:
            started = time.perf_counter()
            wrapper = json.loads(row[1])
            if "fields" in wrapper:
                item = dict(zip(fields, wrapper["fields"][:-1], strict=True))
            else:
                item = json.loads(bytes.fromhex(wrapper["bytes"]) if "bytes" in wrapper else wrapper["raw"])
            decode_ms += (time.perf_counter() - started) * 1000
            decoded += 1
            yield row[0], item
    finally:
        try:
            cursor.close()
        finally:
            if decoded:
                record_stage("payload.decode", decode_ms, rows=decoded)


def payloads_by_rowids(conn, table, rowids, *, order="rowid"):
    if not rowids:
        return []
    with closing(
        conn.execute(
            f"SELECT payload FROM {table} WHERE rowid IN (SELECT value FROM json_each(?)) ORDER BY {order}",
            (json.dumps(list(rowids)),),
        )
    ) as cursor:
        return [json.loads(row[0]) for row in cursor]
