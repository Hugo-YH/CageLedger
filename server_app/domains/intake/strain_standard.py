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
from pathlib import Path
from typing import Any

_ALIAS_PATH = Path(__file__).resolve().parent.parent.parent / "resources" / "intake" / "mgi-strain-aliases.json"
_INDEX_PATH = Path(__file__).resolve().parent.parent.parent / "resources" / "intake" / "mgi-strain-index.json"
_SEPARATOR_RE = re.compile(r"[\s\-_/\\.,;:·（）()【】\[\]<>]+")
_TRAILING_MOUSE_RE = re.compile(r"(小鼠|小白鼠|mouse|mice)$")

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
    key = normalize_strain_key(raw)
    if not key:
        return ""
    alias_map = _alias_map_cached()
    if key in alias_map:
        return alias_map[key]
    stripped = _TRAILING_MOUSE_RE.sub("", key)
    if stripped in alias_map:
        return alias_map[stripped]
    index_map = _index_map_cached()
    return index_map.get(key) or index_map.get(stripped, "")


_SUPPLIER_RULES: tuple[tuple[str, str], ...] = (
    ("江苏集萃药康", "江苏集萃"),
    ("江苏集萃", "江苏集萃"),
    ("广东药康", "广东药康"),
    ("上海南方模式", "上海南模"),
    ("上海南模", "上海南模"),
    ("广东南模", "广东南模"),
    ("珠海百试通", "珠海百试通"),
    ("丹阳昌益", "丹阳昌益"),
    ("北京维通利华", "北京维通利华"),
    ("浙江维通利华", "浙江维通利华"),
    ("上海斯莱克", "上海斯莱克"),
    ("斯莱克", "上海斯莱克"),
    ("北京华阜康", "北京华阜康"),
    ("华阜康", "北京华阜康"),
    ("北京百奥赛图", "北京百奥赛图"),
    ("百奥赛图", "北京百奥赛图"),
)


def abbreviate_supplier(raw: str) -> str:
    """Map a supplier legal name to the facility's short display name."""
    text = str(raw or "").strip()
    for marker, standard in _SUPPLIER_RULES:
        if marker in text:
            return standard
    return text
