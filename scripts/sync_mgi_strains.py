#!/usr/bin/env python3
"""Fetch the official MGI strain report and regenerate the full-name index.

Output: server_app/resources/intake/mgi-strain-index.json

The index maps every normalized MGI strain name to its official name so both
the Python backend and the frontend can resolve any strain written in full
MGI nomenclature, not just the curated common aliases in
mgi-strain-aliases.json.

Usage:
    python3 scripts/sync_mgi_strains.py [--source /path/to/MGI_Strain.rpt]

With --source the script reuses a local report instead of downloading it.
"""

import argparse
import json
import re
import sys
import tempfile
import unicodedata
import urllib.request
from datetime import date
from pathlib import Path

MGI_URL = "https://www.informatics.jax.org/downloads/reports/MGI_Strain.rpt"
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "server_app" / "resources" / "intake" / "mgi-strain-index.json"

_SEPARATOR_RE = re.compile(r"[\s\-_/\\.,;:·（）()【】\[\]<>]+")
_TYPE_PRIORITY = {
    "inbred strain": 0,
    "recombinant inbred (RI)": 1,
    "outbred stock": 2,
    "Not Applicable": 3,
    "Not Specified": 4,
    "recombinant congenic (RC)": 5,
    "consomic": 6,
    "congenic": 7,
    "coisogenic": 8,
    "conplastic": 9,
}


def normalize_key(raw: str) -> str:
    text = unicodedata.normalize("NFKC", str(raw)).strip().lower()
    return _SEPARATOR_RE.sub("", text)


def read_report(source: str | None) -> list[tuple[str, str, str]]:
    if source:
        path = Path(source)
        print(f"Reading {path}", file=sys.stderr)
        return parse_report(path.read_text(encoding="utf-8"))
    with tempfile.NamedTemporaryFile(suffix=".rpt", delete=False) as tmp:
        print(f"Downloading {MGI_URL}", file=sys.stderr)
        urllib.request.urlretrieve(MGI_URL, tmp.name)  # noqa: S310 - fixed trusted source
        return parse_report(Path(tmp.name).read_text(encoding="utf-8"))


def parse_report(text: str) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        key = normalize_key(parts[1])
        if key:
            rows.append((key, parts[1].strip(), parts[2].strip()))
    return rows


def pick_best(variants: list[tuple[str, str]]) -> str:
    """Choose the canonical name among normalized-key collisions."""
    ranked = sorted(
        variants,
        key=lambda item: (_TYPE_PRIORITY.get(item[1], 50), len(item[0]), item[0]),
    )
    return ranked[0][0]


def build_index(rows: list[tuple[str, str, str]]) -> dict[str, str]:
    grouped: dict[str, list[tuple[str, str]]] = {}
    for key, name, strain_type in rows:
        grouped.setdefault(key, []).append((name, strain_type))
    return {key: pick_best(variants) for key, variants in grouped.items()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", help="Local MGI_Strain.rpt file to reuse")
    args = parser.parse_args()
    rows = read_report(args.source)
    index = build_index(rows)
    payload = {
        "source": MGI_URL,
        "fetched": date.today().isoformat(),
        "entries": sorted(index.items()),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(index)} strain names to {OUTPUT} ({OUTPUT.stat().st_size / 1024 / 1024:.2f} MiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
