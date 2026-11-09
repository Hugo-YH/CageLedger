"""Distinguish the mixed-sex form default from evidenced animal-sex facts."""

import re
import unicodedata

MALE = "雄性"
FEMALE = "雌性"
MIXED = "雌性/雄性"


def sex_value(raw):
    text = unicodedata.normalize("NFKC", str(raw or "")).strip().casefold()
    if not text:
        return None
    male = bool(re.search(r"雄|♂|(?<![a-z])male(?![a-z])", text)) or text in {"m", "公", "公鼠"}
    female = bool(re.search(r"雌|♀|(?<![a-z])female(?![a-z])", text)) or text in {"f", "母", "母鼠"}
    if male and female or text in {"mixed", "混合", "混合性别", "both", "公母", "公/母", "公+母"}:
        return MIXED
    if male or text == "m":
        return MALE
    if female or text == "f":
        return FEMALE
    return None


def _count(value):
    if isinstance(value, bool):
        return None
    return int(str(value).strip()) if re.fullmatch(r"\d{1,7}", str(value).strip()) else None


def _count_sex(male, female):
    if male is None or female is None or male + female == 0:
        return None
    return MIXED if male > 0 and female > 0 else MALE if male > 0 else FEMALE


def stated_sex(raw):
    """Read an explicit sex statement, retaining actual zero counts over option text."""
    text = unicodedata.normalize("NFKC", str(raw or "")).casefold()
    values = []
    for pattern in (r"雄(?:性)?|♂|公|(?<![a-z])male(?![a-z])", r"雌(?:性)?|♀|母|(?<![a-z])female(?![a-z])"):
        match = re.search(rf"(?:{pattern})\s*(?:数量)?\s*[:：]?\s*(\d{{1,7}})\s*只?", text)
        values.append(int(match[1]) if match else None)
    if any(value is not None for value in values):
        return _count_sex(*values)
    if re.search(r"默认|占位|未确认|不确定|未知|未提供|未识别|无法", text):
        return None
    return sex_value(text)


def source_sex(source):
    male, female = _count(source.get("maleQuantity")), _count(source.get("femaleQuantity"))
    if male is not None and female is not None:
        return _count_sex(male, female)
    value = stated_sex(source.get("sex"))
    # A source's generic male+female option alone never establishes a mixed batch.
    return value if value in (MALE, FEMALE) else None


def raw_message_sexes(raw):
    return {
        value
        for match in re.finditer(r"(?:^|[\n;；，,])\s*(?:本次|实际)?性别\s*[:：]\s*([^\n;；]+)", str(raw or ""))
        if (value := stated_sex(match[1]))
    }


def _evidence_sexes(evidence):
    evidence = evidence if isinstance(evidence, dict) else {}
    values = {
        value for source in evidence.get("sources", []) if isinstance(source, dict) and (value := source_sex(source))
    }
    # The actual per-image batch counts take precedence over a broad source caption.
    if values:
        return values
    value = stated_sex((evidence.get("fieldSources") or {}).get("sex"))
    return {value} if value else set()


def image_sexes(item):
    return _evidence_sexes(item.get("recognition"))


def _all_evidence_sexes(item):
    values = raw_message_sexes(item.get("rawMessage")) | image_sexes(item)
    for entry in (item.get("recognition") or {}).get("recognitionRounds", []):
        values.update(raw_message_sexes(entry.get("rawMessage")) | _evidence_sexes(entry.get("evidence")))
    return values


def confirmed_sex(item):
    value = sex_value(item.get("sex"))
    if value != MIXED:
        return value
    return MIXED if MIXED in _all_evidence_sexes(item) else None


def placeholder(item):
    # Historical pure-sex image facts do not make a contradictory mixed value an
    # empty field: keep it for manual review instead of accepting arbitrary text.
    return sex_value(item.get("sex")) == MIXED and not _all_evidence_sexes(item)


def sex_source_issues(incoming):
    images = image_sexes(incoming)
    text = raw_message_sexes(incoming.get("rawMessage"))
    current = confirmed_sex(incoming)
    messages = []
    if len(images) > 1:
        messages.append("本轮图片中的实际雌雄数量或明确性别不一致，请逐图核对。")
    if len(text) > 1:
        messages.append("本次预约文字中存在不同的明确性别，请核对原文。")
    if images and (current and images != {current} or text and images != text):
        messages.append("本次性别与图片中的实际雌雄数量或明确性别不一致，请核对原图。")
    if current and text and text != {current}:
        messages.append("本次性别与预约原文的明确性别不一致，请核对原文。")
    return [{"field": "sex", "message": message} for message in messages]


def image_sex_matches(incoming):
    value = confirmed_sex(incoming)
    return bool(value and image_sexes(incoming) == {value})
