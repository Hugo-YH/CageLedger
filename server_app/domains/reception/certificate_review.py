"""Read-only application of current quantity notation to historical AI drafts."""

import re

from .certificate_rules import gender, is_slash_quantity_note

_FIELDS = re.compile(r"^第(\d+)张合格证有待核对字段：(.*)$")
_UNKNOWN = re.compile(r"^第(\d+)张合格证存在未明确数量的明细，须补齐后才能确认保存$")


def current_result(result):
    if not isinstance(result, dict) or not isinstance(result.get("lines"), list):
        return result
    lines, warnings = result["lines"], result.get("warnings", [])
    if any(not isinstance(line, dict) for line in lines):
        return result
    if not isinstance(warnings, list) or any(not isinstance(note, str) for note in warnings):
        return result
    certificates = {line.get("certificateIndex") for line in lines if isinstance(line, dict)}

    def scope(note):
        match = re.match(r"^第(\d+)张合格证", note)
        return int(match[1]) if match else next(iter(certificates)) if len(certificates) == 1 else None

    removed = set()
    for note in warnings:
        certificate = scope(note)
        if certificate is None:
            continue
        fields = _FIELDS.match(note)
        for part in fields[2].split("、") if fields else [note]:
            if not is_slash_quantity_note(part, {"雄性", "雌性", "未知"}):
                continue
            sexes = {sex for char, sex in (("雄", "雄性"), ("雌", "雌性")) if char in part}
            candidates = [
                index
                for index, line in enumerate(lines)
                if line.get("certificateIndex") == certificate
                and line.get("quantity") is None
                and (not sexes or gender(line.get("sex")) in sexes)
            ]
            # An annotation cannot identify which of several unknown rows is '/'.
            if len(candidates) == 1:
                removed.add(candidates[0])
    if not removed:
        return result
    remaining = [line for index, line in enumerate(lines) if index not in removed]
    slash_sexes = {}
    for index in removed:
        line = lines[index]
        slash_sexes.setdefault(line["certificateIndex"], set()).add(gender(line.get("sex")))
    filtered = []
    for note in warnings:
        certificate = scope(note)
        sexes = slash_sexes.get(certificate, set())
        unknown = [
            line for line in remaining if line.get("certificateIndex") == certificate and line.get("quantity") is None
        ]
        fields = _FIELDS.match(note)
        if fields and sexes:
            names = {
                f"{sex}{suffix}"
                for sex in sexes
                if not any(gender(line.get("sex")) == sex for line in unknown)
                for suffix in ("数量", "只数")
            }
            kept = [
                part for part in fields[2].split("、") if part not in names and not is_slash_quantity_note(part, sexes)
            ]
            if kept:
                filtered.append(f"第{fields[1]}张合格证有待核对字段：{'、'.join(kept)}")
        elif is_slash_quantity_note(note, sexes):
            continue
        elif _UNKNOWN.match(note) and certificate in slash_sexes and not unknown:
            continue
        else:
            filtered.append(note)
    return {**result, "lines": remaining, "warnings": filtered}
