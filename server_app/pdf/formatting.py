import calendar


def days_in_month(month):
    try:
        year, value = [int(part) for part in str(month).split("-", 1)]
        return calendar.monthrange(year, value)[1]
    except (TypeError, ValueError):
        return 31


def day_index(value, month):
    text = str(value or "")
    if not text.startswith(f"{month}-"):
        return -1
    try:
        day = int(text.rsplit("-", 1)[1])
        return day - 1 if 1 <= day <= days_in_month(month) else -1
    except ValueError:
        return -1


def format_date(value):
    parts = str(value or "").split("-")
    if len(parts) == 3 and all(part.isdigit() for part in parts):
        return f"{int(parts[0])}.{int(parts[1])}.{int(parts[2])}"
    return str(value or "")


def month_label(value):
    text = str(value or "")
    return f"{text[:4]}年{text[5:7]}月" if len(text) >= 7 else "未命名月份"


def normalize_iacuc(value):
    return str(value or "").strip().upper()


def clean_filename(value):
    text = str(value or "").strip() or "未命名"
    return "".join("_" if char in '\\/:*?"<>|' else char for char in text)
