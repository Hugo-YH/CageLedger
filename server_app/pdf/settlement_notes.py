from html import escape


def settlement_note_markup(statement, columns):
    by_species = {}
    for column in columns:
        by_species.setdefault(column["species"], []).append(column)
    rate_lines = []
    group_count = len(by_species)
    for index, (species, entries) in enumerate(by_species.items(), start=1):
        descriptors = list(dict.fromkeys(rate_descriptor(entry) for entry in entries))
        prefix = f"{index}）" if group_count > 1 else ""
        rate_lines.append(f"<div>&nbsp;&nbsp;{prefix}{html_text(species)} {html_text('；'.join(descriptors))}</div>")
    expiry_note = str(statement.get("notes") or "").strip()
    expiry_markup = (
        f"<div><strong>伦理到期提示：</strong></div><div>{html_text(expiry_note)}</div>" if expiry_note else ""
    )
    return (
        '<div class="note-line"><div><strong>收费标准：</strong></div>' + "".join(rate_lines) + expiry_markup + "</div>"
    )


def rate_descriptor(column):
    unit = "只" if column["unit"] == "animal_day" else "笼"
    if (
        column["species"] == "小鼠"
        and column["tiered"]
        and column["hasTieredCharge"]
        and column["overageUnitPrice"] > 0
        and column["overageUnitPrice"] != column["unitPrice"]
    ):
        return f"笼位数≤160，{number_text(column['unitPrice'])}元/笼/日；笼位数＞160，{number_text(column['overageUnitPrice'])}元/笼/日"
    return f"{number_text(column['unitPrice'])}元/{unit}/日"


def as_number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def number_text(value):
    number = as_number(value)
    return str(int(number)) if number.is_integer() else str(round(number, 2))


def html_text(value):
    return escape(str(value or ""))
