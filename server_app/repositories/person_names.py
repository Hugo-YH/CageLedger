"""Read-only person facets. Raw PI strings remain financial/business identities."""

import json
import re
from collections import Counter
from functools import lru_cache

_SEPARATORS = re.compile(r"[、/\\;；,，|｜／＼\r\n\t]+")
PERSON_COLUMNS = frozenset({"pi", "owner"})


@lru_cache(maxsize=4096)
def split_person_names(raw):
    return tuple(dict.fromkeys(name.strip() for name in _SEPARATORS.split(raw or "") if name.strip()))


def individual_mode(filters, column):
    return filters.get("personFilterMode") == "individual" and column in PERSON_COLUMNS


def prepare_person_filters(conn, filters, source, expressions, *, exclude="", source_params=()):
    """Expand selected people to exact stored keys once per filtered column.

    DISTINCT reads scalar names only; the final list retains its existing SQL
    pagination, scopes, indexed equality, totals and full raw identities. There
    is no persistent derived state, migration, write-back or per-row query.
    Source and expressions are repository-owned SQL, never request values.
    """
    selected = filters.get("columnFilters") or {}
    if isinstance(selected, str):
        selected = json.loads(selected)
    if not isinstance(selected, dict):
        raise ValueError("列筛选格式无效")
    resolved = {}
    for column, expression in expressions.items():
        if column == exclude or not individual_mode(filters, column) or not selected.get(column):
            continue
        people = set(selected[column])
        rows = conn.execute(f"SELECT DISTINCT {expression} FROM {source}", source_params)
        resolved[column] = [row[0] for row in rows if people.intersection(split_person_names(row[0]))]
    return {**filters, "_individualPersonValues": resolved} if resolved else filters


def column_predicate(filters, column, expression, values):
    if individual_mode(filters, column):
        resolved = filters.get("_individualPersonValues", {})
        if column not in resolved:
            raise ValueError("个人筛选尚未解析")
        return f"{expression} IN (SELECT value FROM json_each(?))", [json.dumps(resolved[column], ensure_ascii=False)]
    marks = ", ".join("?" for _ in values)
    return f"{expression} IN ({marks})", list(values)


def person_options(filters, column, items):
    if not individual_mode(filters, column):
        return items
    counts = Counter()
    for item in items:
        for person in split_person_names(item["value"]):
            counts[person] += item["count"]
    return [{"value": name, "label": name, "count": counts[name]} for name in sorted(counts)]
