"""Explicit choices resolve ordinary field differences, never appointment identity."""

FIELDS = frozenset(
    (
        "quantity",
        "strainStandard",
        "specification",
        "species",
        "sex",
        "roomName",
        "intakeDate",
        "endDate",
        "husbandryMonths",
        "husbandryDays",
    )
)


def read_resolutions(raw):
    if raw is None:
        return {}
    if not isinstance(raw, dict) or len(raw) > len(FIELDS):
        raise ValueError("预约字段选择格式无效")
    if any(field not in FIELDS or choice not in ("saved", "incoming") for field, choice in raw.items()):
        raise ValueError("只能选择可核对字段的原预约值或本次值")
    return dict(raw)


def field_resolutions(rows, requested, *, eligible, saved_image_first, image_fields):
    fields = [row["field"] for row in rows if eligible and row["status"] == "different" and row["field"] in FIELDS]
    choices = {}
    for field in fields:
        if field in requested:
            choices[field] = requested[field]
        elif saved_image_first:
            choices[field] = "saved"
        elif field in image_fields:
            choices[field] = "incoming"
    return fields, choices
