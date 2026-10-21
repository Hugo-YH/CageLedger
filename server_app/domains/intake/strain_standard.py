"""Deterministic mouse strain and supplier standardization.

Strain names follow the curated MGI alias table under
server_app/resources/intake/mgi-strain-aliases.json, which is derived from the
official MGI strain report so the facility prints and matches one stable name.
The AI prompt still extracts the raw strain; this module is the authoritative
fallback so known variants always resolve to the same standard name.
"""

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any

_ALIAS_PATH = Path(__file__).resolve().parent.parent.parent / "resources" / "intake" / "mgi-strain-aliases.json"
_INDEX_PATH = Path(__file__).resolve().parent.parent.parent / "resources" / "intake" / "mgi-strain-index.json"
_SEPARATOR_RE = re.compile(r"[\s\-_/\\.,;:·（）()【】\[\]<>]+")
_TRAILING_MOUSE_RE = re.compile(r"(小鼠|小白鼠|mouse|mice)$")
_NOTE_SEPARATOR_RE = re.compile(r"[，,、；;]")

_entries: list[dict[str, Any]] | None = None
_alias_map: dict[str, str] | None = None
_index_map: dict[str, str] | None = None


def normalize_strain_key(raw: str) -> str:
    """Collapse separators, case and full-width forms into a match key."""
    text = unicodedata.normalize("NFKC", str(raw or "")).strip().lower()
    return _SEPARATOR_RE.sub("", text)


def _load_entries() -> list[dict[str, Any]]:
    data = json.loads(_ALIAS_PATH.read_text(encoding="utf-8"))
    return data["entries"]


def _alias_map_cached() -> dict[str, str]:
    global _entries, _alias_map
    if _alias_map is None:
        loaded = _load_entries()
        alias_map: dict[str, str] = {}
        for entry in loaded:
            standard = entry["standard"]
            for alias in entry["aliases"]:
                alias_map[normalize_strain_key(alias)] = standard
        _entries = loaded
        _alias_map = alias_map
    return _alias_map


def _index_map_cached() -> dict[str, str]:
    global _index_map
    if _index_map is None:
        data = json.loads(_INDEX_PATH.read_text(encoding="utf-8"))
        _index_map = {key: name for key, name in data["entries"]}
    return _index_map


def standardize_strain(raw: str) -> str:
    """Return the standard strain name for a known alias, or empty string."""
    text = str(raw or "").strip()
    if not text:
        return ""
    alias_map = _alias_map_cached()
    segments = _NOTE_SEPARATOR_RE.split(text, maxsplit=1)
    candidates = [text]
    if len(segments) > 1 and segments[0].strip():
        candidates.insert(0, segments[0].strip())
    for candidate in candidates:
        key = normalize_strain_key(candidate)
        if not key:
            continue
        if key in alias_map:
            return alias_map[key]
        stripped = _TRAILING_MOUSE_RE.sub("", key)
        if stripped in alias_map:
            return alias_map[stripped]
    index_map = _index_map_cached()
    for candidate in candidates:
        key = normalize_strain_key(candidate)
        if not key:
            continue
        stripped = _TRAILING_MOUSE_RE.sub("", key)
        index_name = index_map.get(key) or index_map.get(stripped)
        if index_name:
            return index_name
    return ""


_SUPPLIER_ALIAS_PATH = _ALIAS_PATH.with_name("supplier-aliases.json")
_SUPPLIER_SEPARATOR_RE = re.compile(r"[\s()（）·\-—_]")
_SUPPLIER_BRANCH_RE = re.compile(r"分公司|分厂|分部|办事处")


def _supplier_key(raw: str) -> str:
    return _SUPPLIER_SEPARATOR_RE.sub("", unicodedata.normalize("NFKC", raw).lower())


@lru_cache(maxsize=1)
def _supplier_mappings():
    catalog = json.loads(_SUPPLIER_ALIAS_PATH.read_text(encoding="utf-8"))
    rules = []
    exact = {}
    for entry in catalog["entries"]:
        for alias in dict.fromkeys(entry["companyNames"] + entry["aliases"]):
            rules.append((_supplier_key(alias), entry["shortName"]))
        for alias in [entry["shortName"], *entry["exactAliases"]]:
            exact[_supplier_key(alias)] = entry["shortName"]
    return sorted(rules, key=lambda rule: len(rule[0]), reverse=True), exact


def abbreviate_supplier(raw: str) -> str:
    """Resolve verified regional names using the frontend's shared supplier catalog."""
    text = str(raw or "").strip()
    key = _supplier_key(text)
    rules, exact = _supplier_mappings()
    if key in exact:
        return exact[key]
    for marker, standard in rules:
        if marker in key:
            if _SUPPLIER_BRANCH_RE.search(key) and not _SUPPLIER_BRANCH_RE.search(marker):
                return text
            return standard
    return text
