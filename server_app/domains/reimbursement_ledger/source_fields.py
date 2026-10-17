"""Bounded memoization of pure source decoding, never of database reads."""

import json
from functools import lru_cache

from server_app.repositories.workflow_sources import source_fee_type
from server_app.shared import clean_text

from .repository import money


def source_fields(payload, workflow_iacuc):
    # Bound both entry count and key length. Unusually large historical
    # headers still take the original decode path, with no admission to cache.
    decode = _cached_source_fields if len(payload) <= 8192 and len(workflow_iacuc or "") <= 1024 else _decode
    return decode(payload, workflow_iacuc)


def _decode(payload, workflow_iacuc):
    statement = dict(json.loads(payload).get("statement") or {})
    iacucs = [clean_text(value) for value in statement.get("iacucs", []) if clean_text(value)]
    iacuc = "、".join(dict.fromkeys(iacucs)) or clean_text(statement.get("iacuc", workflow_iacuc))
    return (
        money(statement.get("totalAmount", 0)),
        clean_text(statement.get("pi", "")),
        iacuc,
        source_fee_type(statement.get("sourceType")),
    )


_cached_source_fields = lru_cache(maxsize=512)(_decode)
