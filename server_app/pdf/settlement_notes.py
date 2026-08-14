from html import escape


def settlement_note_markup(statement, columns, lines=()):
    by_species = {}
    for column in columns:
        by_species.setdefault(column["species"], []).append(column)
    rate_entries = []
    group_count = len(by_species)
    for index, (species, entries) in enumerate(by_species.items(), start=1):
        descriptors = list(dict.fromkeys(rate_descriptor(entry) for entry in entries))
        prefix = f"{index}）" if group_count > 1 else ""
        rate_entries.append(f"{prefix}{species} {'；'.join(descriptors)}")
    rate_markup = note_entry_markup("收费标准：", "、".join(rate_entries)) if rate_entries else ""
    custom_markup = custom_billing_note_markup(lines)
    expiry_note = str(statement.get("notes") or "").strip()
    expiry_markup = note_entry_markup("伦理到期提示：", expiry_note) if expiry_note else ""
    return '<div class="note-line">' + rate_markup + custom_markup + expiry_markup + "</div>"


def custom_billing_note_markup(lines):
    details = {}
    for line in lines or ():
        for item in line.get("iacucBreakdown") or ():
            if not item.get("customBilling"):
                continue
            billing_unit = str(item.get("billingUnit") or "")
            key = (
                str(item.get("iacuc") or "").strip().upper(),
                str(item.get("customBillingSegmentId") or "").strip(),
                str(item.get("customBillingStartDate") or "").strip(),
                str(item.get("customBillingEndDate") or "").strip(),
                as_number(item.get("unitPrice")),
                billing_unit,
                str(item.get("customBillingNote") or "").strip(),
            )
            current = details.setdefault(
                key,
                {
                    "iacuc": key[0],
                    "startDate": key[2],
                    "endDate": key[3],
                    "quantity": as_number(
                        item.get("animalCount") if billing_unit == "animal_day" else item.get("cageCount")
                    ),
                    "unitPrice": key[4],
                    "billingUnit": billing_unit,
                    "note": key[6],
                    "amount": 0,
                },
            )
            current["amount"] += as_number(item.get("payableAmount", item.get("amount")))
    if not details:
        return ""
    rows = []
    for item in sorted(details.values(), key=lambda value: (value["iacuc"], value["startDate"], value["endDate"])):
        unit = "只" if item["billingUnit"] == "animal_day" else "笼"
        period = f"{item['startDate'] or '-'} 至 {item['endDate'] or '-'}"
        note = f"，{item['note']}" if item["note"] else ""
        rows.append(
            f"{item['iacuc']}：{period}，每日 {number_text(item['quantity'])}{unit}，"
            f"{number_text(item['unitPrice'])}元/{unit}/日，本期 {number_text(item['amount'])}元{note}"
        )
    return "".join(note_entry_markup("自定义收费：" if index == 0 else "", row) for index, row in enumerate(rows))


def note_entry_markup(title, detail):
    return (
        '<div class="note-entry">'
        + (f"<strong>{html_text(title)}</strong>" if title else "")
        + f'<span class="note-detail">{html_text(detail)}</span></div>'
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
