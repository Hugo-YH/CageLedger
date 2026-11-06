"""Reuse only pure projection work, keyed by all values read in the current snapshot."""

import hashlib
import json
from functools import lru_cache

from server_app.repositories.person_names import split_person_names

PROJECT_FIELDS = ("iacuc", "project", "pi", "owner", "funding", "fundCode", "projectEndDate")
MAX_CACHED_CHARACTERS = 2 * 1024 * 1024
MAX_CACHED_ROWS = 20000


def encode_items(items):
    items = [{key: item.get(key) for key in PROJECT_FIELDS} for item in items]
    for item in items:
        for key in ("pi", "owner"):
            item[f"_{key}People"] = list(split_person_names(item.get(key)))
    content = json.dumps(items, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return content, hashlib.sha256(content.encode()).hexdigest()


def _encode_rows(rows):
    return encode_items(dict(zip(PROJECT_FIELDS, json.loads(fields), strict=True)) for fields in rows)


@lru_cache(maxsize=2)
def _cached_rows(rows):
    return _encode_rows(rows)


def encode_rows(rows):
    # Always read the database first, even in a write transaction. No TTL, database
    # identity or import timestamp can stand in for its transaction-visible values.
    # Cache immutable strings only; oversized indexes still work without retention.
    if len(rows) <= MAX_CACHED_ROWS and sum(map(len, rows)) <= MAX_CACHED_CHARACTERS:
        return _cached_rows(rows)
    return _encode_rows(rows)
