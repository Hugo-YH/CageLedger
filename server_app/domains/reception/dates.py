from datetime import date


def valid_date(value):
    value = str(value).strip(" ") if value is not None else ""
    try:
        normalized = date.fromisoformat(value).isoformat()
        return normalized if normalized == value else ""
    except ValueError:
        return ""


def receipt_dates(batch):
    actual = sorted(
        {
            value
            for entry in batch.get("receipts") or []
            if isinstance(entry, dict) and (value := valid_date(entry.get("actualReceiptDate")))
        }
    )
    original = valid_date(batch.get("intakeDate"))
    if actual:
        return actual, "actual"
    return ([original], "original") if original else ([], "missing")


def sql_valid_date(expression):
    # Match the strict ISO parser above, including leap days and canonical padding.
    return (
        f"length({expression})=10 AND {expression} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' "
        f"AND {expression}>='0001-01-01' AND date({expression},'+0 days')={expression}"
    )
