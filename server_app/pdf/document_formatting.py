"""Shared document shell, safe escaping, numeric and filename formatting."""

from html import escape


def document_html(title, styles, body):
    return f'<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>{h(title)}</title><style>{styles}</style></head><body>{body}</body></html>'


def document_number_for(statement):
    source = "QS" if "quantity_sheet" in str(statement.get("sourceType") or "") else "CM"
    identifier = "".join(
        char for char in str(statement.get("id") or "PREVIEW") if char.isalnum() or char == "-"
    ).upper()
    return f"CL-{source}-{str(statement.get('month') or '').replace('-', '')}-{identifier}"


def clean_filename(value):
    text = str(value or "").strip() or "未命名"
    return "".join("_" if char in '\\/:*?"<>|' else char for char in text)


def as_number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def number_text(value):
    number = as_number(value)
    if not number:
        return ""
    return str(int(number)) if number.is_integer() else str(round(number, 2))


def number_text_or_blank(value):
    if value is None:
        return ""
    number = as_number(value)
    return str(int(number)) if number.is_integer() else str(round(number, 2))


def h(value):
    return escape(str(value or ""), quote=True)
