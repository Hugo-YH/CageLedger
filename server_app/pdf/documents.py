import calendar
from html import escape

from server_app.pdf.renderer import html_to_pdf

GROUP_UNITS = 12
LEFT_COLUMN_DAYS = 15
PRINT_ROWS = 16


def render_quantity_sheet_pdf(sheet):
    return html_to_pdf(quantity_sheet_html(sheet))


def render_billing_statement_pdf(statement, lines):
    return html_to_pdf(billing_statement_html(statement, lines))


def quantity_sheet_filename(sheet):
    return f"实验动物数量统计表 {month_label(sheet.get('month'))} {clean_filename(sheet.get('iacuc'))}.pdf"


def billing_statement_filename(statement):
    return f"{clean_filename(statement.get('pi') or '未命名课题组')}课题组实验动物饲养费核算汇总表 {month_label(statement.get('month'))}.pdf"


def quantity_sheet_html(sheet):
    rows = quantity_sheet_pages(sheet)
    pages = "".join(quantity_page_markup(sheet, page, index) for index, page in enumerate(rows))
    return document_html("实验动物数量统计表", quantity_styles(), pages)


def quantity_sheet_pages(sheet):
    month = str(sheet.get("month") or "")
    page_count = max(int(sheet.get("pageCount") or 1), 1)
    raw_rows = list(sheet.get("rows") or [])
    pages = [[None] * 31 for _ in range(max(page_count, (len(raw_rows) + 30) // 31, 1))]
    for row in raw_rows:
        index = day_index(row.get("date"), month)
        target = next((page for page in pages if index >= 0 and page[index] is None), None)
        if target is None:
            target = next((page for page in pages if any(item is None for item in page)), None)
        if target is None:
            target = [None] * 31
            pages.append(target)
        if index >= 0 and target[index] is None:
            target[index] = row
        else:
            target[target.index(None)] = row
    return [fill_quantity_calendar(sheet, page) for page in pages]


def fill_quantity_calendar(sheet, rows):
    month = str(sheet.get("month") or "")
    total_days = days_in_month(month)
    show_animals = sheet.get("billingUnit") == "animal_day" or bool(sheet.get("animalDetailEnabled"))
    animals = as_number(sheet.get("initialAnimalCount"))
    cages = as_number(sheet.get("initialCageCount"))
    started = animals > 0 or cages > 0
    filled = []
    for index, row in enumerate(rows):
        if index >= total_days:
            filled.append(None)
            continue
        source = dict(row or {})
        if row:
            animals = (
                as_number(row.get("animalCount"))
                if row.get("animalCount") is not None
                else max(animals + as_number(row.get("addedCount")) - as_number(row.get("removedCount")), 0)
            )
            cages = as_number(row.get("cageCount")) if row.get("cageCount") is not None else cages
            started = started or any(
                row.get(key) is not None and row.get(key) != ""
                for key in ("addedCount", "removedCount", "animalCount", "cageCount")
            )
        source.update(
            {
                "date": f"{month}-{index + 1:02d}",
                "animalCount": animals if show_animals and started else None,
                "cageCount": cages if started else None,
                "handler": "",
            }
        )
        filled.append(source)
    return filled


def quantity_page_markup(sheet, rows, page_index):
    left = rows[:LEFT_COLUMN_DAYS]
    right = rows[LEFT_COLUMN_DAYS:]
    body_rows = "".join(
        f"<tr>{quantity_day_cells(left[index] if index < len(left) else None)}{quantity_day_cells(right[index] if index < len(right) else None)}</tr>"
        for index in range(PRINT_ROWS)
    )
    custom_price = as_number(sheet.get("customUnitPrice"))
    footer = f"项目名称：{h(sheet.get('project'))}"
    if sheet.get("fullExemption"):
        footer += "　减免方式：全额减免"
    if sheet.get("customBillingEnabled") and custom_price:
        unit = "只/天" if sheet.get("billingUnit") == "animal_day" else "笼/天"
        footer += f"　计费标准：自定义 ¥{custom_price:.2f} / {unit}"
    if int(sheet.get("pageCount") or 1) > 1:
        footer += f"　（第 {page_index + 1} 页）"
    return f"""<section class="sheet-page">
<div class="sheet-topline">中山大学中山眼科中心 实验动物中心</div>
<table class="sheet-table"><colgroup><col style="width:8%"><col style="width:11%"><col style="width:11%"><col style="width:6%"><col style="width:6%"><col style="width:10%"><col style="width:8%"><col style="width:11%"><col style="width:11%"><col style="width:6%"><col style="width:6%"><col style="width:10%"></colgroup>
<tr><th class="title" colspan="12">实验动物数量统计表</th></tr>
<tr><td class="note" colspan="8">备注：饲养费计算以此表动物数量为准，请如实填写。填写说明：购：购入　转：转移　分：分笼　取：取材或处理　死：死亡</td><td class="meta" colspan="2">房间号：{h(sheet.get("roomName"))}</td><td class="meta" colspan="2">房间管理员：{h(sheet.get("roomManager") or sheet.get("manager"))}</td></tr>
<tr><td class="label" colspan="2">IACUC编号</td><td colspan="2">{h(sheet.get("iacuc"))}</td><td class="label" colspan="2">项目负责人</td><td colspan="2">{h(sheet.get("pi"))}</td><td class="label" colspan="2">实验负责人及电话</td><td colspan="2">{h(sheet.get("owner"))}</td></tr>
<tr>{quantity_headers()}{quantity_headers()}</tr>{body_rows}
<tr><td class="footer-row" colspan="12">{footer}</td></tr></table></section>"""


def quantity_headers():
    return "<td>日期</td><td>新增（购/转/分）</td><td>减少（取/死/转）</td><td>结余总数</td><td>结余笼数</td><td>经手人</td>"


def quantity_day_cells(row):
    if not row:
        return "<td></td>" * 6
    return (
        f"<td>{format_date(row.get('date'))}</td>"
        f"<td>{h(format_quantity_change(row.get('addedCount'), row.get('addedType'), row.get('transferInFromIacuc'), '转入'))}</td>"
        f"<td>{h(format_quantity_change(row.get('removedCount'), row.get('removedType'), row.get('transferOutToIacuc'), '转出'))}</td>"
        f'<td class="num">{number_text_or_blank(row.get("animalCount"))}</td>'
        f'<td class="num">{number_text_or_blank(row.get("cageCount"))}</td><td></td>'
    )


def billing_statement_html(statement, lines):
    kept_lines = [
        line
        for line in lines
        if as_number(line.get("animalCount"))
        or as_number(line.get("cageCount"))
        or as_number(line.get("amount"))
        or line.get("quantitySheetRowIds")
    ]
    unit = statement_unit(statement, kept_lines)
    columns = statement_columns(statement, kept_lines)
    modeled = [statement_row(line, columns, unit) for line in kept_lines]
    summaries = {column["key"]: summary_for_column(column["key"], modeled) for column in columns}
    for column in columns:
        summary = summaries[column["key"]]
        column["showFree"] = summary["free"] > 0
        column["showTiered"] = summary["tier"] > 0
    pages = settlement_pages(columns)
    total_count = display_total_count(statement, unit, summaries.values())
    total_free = as_number(statement.get("totalFreeCageDays"))
    total_tier = as_number(statement.get("totalTier2CageDays"))
    total_payable = sum(summary["amount"] for summary in summaries.values())
    result = []
    for index, page in enumerate(pages):
        result.append(
            settlement_page_markup(
                statement,
                modeled,
                page,
                summaries,
                unit,
                total_count,
                total_free,
                total_tier,
                total_payable,
                index,
                len(pages),
            )
        )
    return document_html(
        billing_statement_filename(statement).removesuffix(".pdf"), settlement_styles(), "".join(result)
    )


def statement_columns(statement, lines):
    order = {normalize_iacuc(value): index for index, value in enumerate(statement.get("iacucs") or [])}
    columns = {}
    for line in lines:
        for item in line.get("iacucBreakdown") or []:
            iacuc = normalize_iacuc(item.get("iacuc"))
            if not iacuc:
                continue
            key = breakdown_key(item)
            if key in columns:
                continue
            columns[key] = {
                "key": key,
                "iacuc": iacuc,
                "species": species_label(item),
                "unit": str(item.get("billingUnit") or ""),
                "unitPrice": as_number(item.get("unitPrice")),
                "overageUnitPrice": as_number(item.get("overageUnitPrice")),
                "tiered": bool(item.get("tiered")),
                "fullExemption": bool(item.get("fullExemption")),
            }
    sorted_columns = sorted(
        columns.values(),
        key=lambda item: (
            order.get(item["iacuc"], 10**9),
            item["iacuc"],
            item["species"],
            item["unit"],
            item["unitPrice"],
        ),
    )
    labels = {}
    for item in sorted_columns:
        base = item["iacuc"] if item["species"] == "小鼠" else f"{item['iacuc']}（{item['species']}）"
        labels[base] = labels.get(base, 0) + 1
    for item in sorted_columns:
        base = item["iacuc"] if item["species"] == "小鼠" else f"{item['iacuc']}（{item['species']}）"
        suffix = f" / ¥{item['unitPrice']:.2f}" if labels[base] > 1 else ""
        item["label"] = f"{base}{suffix}"
    return sorted_columns


def statement_row(line, columns, unit):
    values = {column["key"]: empty_summary() for column in columns}
    for item in line.get("iacucBreakdown") or []:
        key = breakdown_key(item)
        if key not in values:
            continue
        current = values[key]
        count = as_number(item.get("animalCount") if item.get("billingUnit") == "animal_day" else item.get("cageCount"))
        free = as_number(item.get("freeCages"))
        current["count"] += count
        current["free"] += free
        current["support"] += as_number(item.get("supportAmount"))
        current["amount"] += as_number(item.get("payableAmount", item.get("amount")))
        current["tier"] += as_number(item.get("tier2BillableCages"))
    return {
        "date": str(line.get("date") or ""),
        "totalCount": display_line_count(line, unit, values.values()),
        "totalFree": as_number(line.get("freeCages")),
        "totalTier": as_number(line.get("tier2BillableCages")),
        "values": values,
    }


def settlement_pages(columns):
    first = columns[:4]
    pages = [{"slots": first + [None] * (4 - len(first)), "leading": True}]
    rest = columns[4:]
    for index in range(0, len(rest), 5):
        chunk = rest[index : index + 5]
        pages.append({"slots": chunk + [None] * (5 - len(chunk)), "leading": False})
    return pages


def settlement_page_markup(
    statement, rows, page, summaries, unit, total_count, total_free, total_tier, total_payable, page_index, total_pages
):
    slots = page["slots"]
    page_has_free = (total_free > 0 if page["leading"] else False) or any(
        slot and summaries[slot["key"]]["free"] > 0 for slot in slots
    )
    page_has_tier = (total_tier > 0 if page["leading"] else False) or any(
        slot and summaries[slot["key"]]["tier"] > 0 for slot in slots
    )
    title_suffix = (
        f"（减免{number_text(statement.get('freeCageAllowance'))}笼）"
        if unit == "cage_day" and as_number(statement.get("freeCageAllowance")) > 0
        else ""
    )
    title = f"{h(statement.get('pi') or '-')}课题组实验动物饲养费核算汇总表{title_suffix}"
    all_iacucs = "、".join(dict.fromkeys(slot["iacuc"] for slot in slots if slot))
    full = "、".join(dict.fromkeys(slot["iacuc"] for slot in slots if slot and slot["fullExemption"]))
    leading_cols = "".join('<col class="col-group">' for _ in range(GROUP_UNITS)) if page["leading"] else ""
    columns_cols = "".join("".join('<col class="col-group">' for _ in range(GROUP_UNITS)) for _ in slots)
    headers = "".join(
        f'<th colspan="{GROUP_UNITS}" class="column-empty"></th>'
        if not slot
        else f'<th colspan="{GROUP_UNITS}">{h(slot["label"])}{("（梯度收费）" if slot["showTiered"] else "")}{("（全额减免）" if slot["fullExemption"] else "")}</th>'
        for slot in slots
    )
    leading_header = f'<th colspan="{GROUP_UNITS}">汇总</th>' if page["leading"] else ""
    leading_sub = group_headers(unit_label(unit, total=True), page_has_free, page_has_tier) if page["leading"] else ""
    sub_headers = "".join(
        group_headers(
            "" if not slot else ("数量" if slot["unit"] == "animal_day" else "笼数"),
            slot["showFree"] if slot else False,
            slot["showTiered"] if slot else False,
        )
        for slot in slots
    )
    detail_rows = []
    for row in rows:
        leading_values = (
            group_cells(
                {"count": row["totalCount"], "free": row["totalFree"], "tier": row["totalTier"], "amount": 0},
                page_has_free,
                page_has_tier,
                False,
            )
            if page["leading"]
            else ""
        )
        values = "".join(
            group_cells(row["values"].get(slot["key"], empty_summary()), slot["showFree"], slot["showTiered"], True)
            if slot
            else f'<td colspan="{GROUP_UNITS}" class="group-empty-cell"></td>'
            for slot in slots
        )
        detail_rows.append(f"<tr><td>{h(row['date'])}</td>{leading_values}{values}</tr>")
    total_values = "".join(
        group_cells(summaries[slot["key"]], slot["showFree"], slot["showTiered"], True)
        if slot
        else f'<td colspan="{GROUP_UNITS}" class="group-empty-cell"></td>'
        for slot in slots
    )
    leading_totals = (
        group_cells(
            {"count": total_count, "free": total_free, "tier": total_tier, "amount": 0},
            page_has_free,
            page_has_tier,
            False,
        )
        if page["leading"]
        else ""
    )
    summary_label = "本月待缴纳饲养费<br>总计（元）" if page_index == 0 else "本页汇总"
    leading_summary = (
        f'<td colspan="7" class="row-label row-label-summary">{summary_label}</td><td colspan="6" class="money summary-total-money">{total_payable:.2f}</td>'
        if page["leading"]
        else f'<td class="row-label row-label-summary">{summary_label}</td>'
    )
    meta_summary = "".join(
        f'<td colspan="{GROUP_UNITS}" class="meta-summary"><span>单位支持：{summaries[slot["key"]]["support"]:.2f}</span><span>实际待缴纳：{summaries[slot["key"]]["amount"]:.2f}</span></td>'
        if slot
        else f'<td colspan="{GROUP_UNITS}" class="meta-summary meta-summary-empty"></td>'
        for slot in slots
    )
    document_number = h(statement.get("documentNumber") or document_number_for(statement))
    return f"""<main class="document {"document-page-break" if page_index < total_pages - 1 else ""}">
<section class="header"><div class="header-grid"><div class="header-main"><h1>{title}</h1><div class="meta"><div>单据编号：{document_number}</div><div>结算月份：{h(statement.get("month"))}</div><div>项目负责人：{h(statement.get("pi"))}</div></div></div></div></section>
<table class="meta-table"><tbody><tr><td>出具科室：实验动物中心</td><td>计费单位：{unit_display(unit)}</td><td colspan="2">实验负责人：{h(statement.get("owner") or "-")}</td></tr><tr><td colspan="4">IACUC 编号：{h(all_iacucs or "-")} {f"　全额减免：{h(full)}" if full else ""}</td></tr><tr><td colspan="4">支撑经费：{h(statement.get("funding") or "-")}</td></tr></tbody></table>
<table class="summary-table"><colgroup><col class="col-date">{leading_cols}{columns_cols}</colgroup><thead><tr><th class="date-column" rowspan="2">日期</th>{leading_header}{headers}</tr><tr>{leading_sub}{sub_headers}</tr></thead><tbody>{"".join(detail_rows)}</tbody><tfoot><tr><td class="row-label">单项合计</td>{leading_totals}{total_values}</tr><tr>{leading_summary}{meta_summary}</tr></tfoot></table>
<div class="note-line">说明：{h(statement.get("notes") or "")}</div><table class="sign-table"><tbody><tr><td>项目负责人</td><td>实验负责人/经办人</td><td>日期</td></tr></tbody></table><div class="page-footer">第 {page_index + 1} / {total_pages} 页</div></main>"""


def group_headers(count_label, show_free, show_tier):
    labels = (
        [count_label]
        + (["减免"] if show_free else [])
        + (["梯度"] if show_tier else [])
        + (["缴纳（元）"] if count_label else [])
    )
    labels = [item for item in labels if item]
    return (
        "".join(
            f'<th colspan="{span}">{h(label)}</th>'
            for label, span in zip(labels, split_units(len(labels)), strict=False)
        )
        if labels
        else f'<th colspan="{GROUP_UNITS}"></th>'
    )


def group_cells(summary, show_free, show_tier, show_amount):
    cells = [("num", number_text(summary.get("count")))]
    if show_free:
        cells.append(("num", number_text(summary.get("free"))))
    if show_tier:
        cells.append(("num", number_text(summary.get("tier"))))
    if show_amount:
        has_value = any(as_number(summary.get(key)) > 0 for key in ("count", "free", "tier", "amount"))
        cells.append(("money", f"{as_number(summary.get('amount')):.2f}" if has_value else ""))
    return "".join(
        f'<td colspan="{span}" class="{class_name}{"" if value else " group-empty-cell"}">{value}</td>'
        for (class_name, value), span in zip(cells, split_units(len(cells)), strict=False)
    )


def split_units(parts):
    if not parts:
        return []
    base, remainder = divmod(GROUP_UNITS, parts)
    return [base + (1 if index < remainder else 0) for index in range(parts)]


def summary_for_column(key, rows):
    result = empty_summary()
    for row in rows:
        value = row["values"].get(key, empty_summary())
        for field in result:
            result[field] += as_number(value.get(field))
    return result


def empty_summary():
    return {"count": 0, "free": 0, "tier": 0, "support": 0, "amount": 0}


def statement_unit(statement, lines):
    declared = str(statement.get("billingUnit") or "")
    if declared and declared != "mixed":
        return declared
    units = {str(item.get("billingUnit") or "cage_day") for line in lines for item in line.get("iacucBreakdown") or []}
    return "mixed" if len(units) > 1 else (next(iter(units), "cage_day"))


def display_line_count(line, unit, summaries):
    if unit == "animal_day":
        return as_number(line.get("animalCount"))
    if unit == "cage_day":
        return as_number(line.get("cageCount"))
    return sum(as_number(item.get("count")) for item in summaries)


def display_total_count(statement, unit, summaries):
    if unit == "animal_day":
        return as_number(statement.get("totalAnimalDays"))
    if unit == "cage_day":
        return as_number(statement.get("totalCageDays"))
    return sum(as_number(item.get("count")) for item in summaries)


def unit_label(unit, total=False):
    if unit == "animal_day":
        return "总数量" if total else "数量"
    if unit == "mixed":
        return "总量" if total else "数量"
    return "总笼数" if total else "笼数"


def unit_display(unit):
    return {"animal_day": "只/天", "cage_day": "笼/天"}.get(unit, "混合")


def breakdown_key(item):
    return "|".join(
        [
            normalize_iacuc(item.get("iacuc")),
            species_label(item),
            str(item.get("billingItem") or ""),
            str(item.get("billingUnit") or ""),
            f"{as_number(item.get('unitPrice')):.2f}",
            f"{as_number(item.get('overageUnitPrice')):.2f}",
            "1" if item.get("tiered") else "0",
            "1" if item.get("freeAllowance") else "0",
            "1" if item.get("fullExemption") else "0",
        ]
    )


def species_label(item):
    label = str(item.get("billingItem") or "")
    for species in ("小鼠", "大鼠", "豚鼠", "兔", "猴", "猪", "犬"):
        if species in label:
            return species
    if item.get("billingUnit") == "animal_day":
        return "动物"
    return "小鼠" if as_number(item.get("unitPrice")) in {4.5, 6.5, 7.2, 13.5, 19.5, 21.6} else "动物"


def quantity_styles():
    return """@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#000;background:#fff;font-family:"Arial","Helvetica Neue","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:9px}.sheet-page{min-height:276mm;page-break-after:always}.sheet-page:last-child{page-break-after:auto}.sheet-topline{font-size:8px;margin-bottom:4px}.sheet-table{border-collapse:collapse;width:100%;table-layout:fixed}.sheet-table th,.sheet-table td{border:1px solid #000;padding:3px 4px;text-align:center;vertical-align:middle;word-break:break-all}.sheet-table .title{font-size:18px;padding:8px 0;font-weight:700}.sheet-table .note{color:#c80000;font-weight:700;text-align:left;line-height:1.35}.sheet-table .meta,.sheet-table .label,.sheet-table .footer-row{font-weight:700}.sheet-table .footer-row{text-align:left;height:26px}.sheet-table .num{font-variant-numeric:tabular-nums}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}"""


def settlement_styles():
    return """@page{size:A4;margin:10mm}*{box-sizing:border-box}body{color:#111;font-family:"Arial","Helvetica Neue","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:8.4px;line-height:1.2;margin:0;background:#fff}.document{max-width:190mm;min-height:277mm;margin:0 auto}.document-page-break{page-break-after:always;break-after:page}.header{border:1px solid #000;padding:6px 8px}.header-grid{display:block}.header-main{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}h1{font-size:15px;line-height:1.1;margin:0 0 4px;display:flex;align-items:flex-end;justify-content:center;gap:8px;flex-wrap:wrap}.meta{display:grid;grid-template-columns:repeat(3,max-content);justify-content:center;gap:2px 10px;margin-top:4px}.meta-table,.summary-table,.sign-table{border-collapse:collapse;width:100%;table-layout:fixed;margin-top:6px}.meta-table td,.summary-table th,.summary-table td,.sign-table td{border:1px solid #000;padding:3px 4px;vertical-align:middle}.meta-table td{text-align:left}.summary-table th,.summary-table td{text-align:center}.summary-table td:first-child,.summary-table .row-label,.summary-table .meta-summary,.sign-table td{text-align:left}.summary-table .date-column{text-align:center;white-space:nowrap;width:16mm;min-width:16mm;max-width:16mm}.summary-table td:first-child{white-space:nowrap;width:16mm;min-width:16mm;max-width:16mm}.summary-table th{line-height:1.15}.summary-table thead th{white-space:nowrap;text-align:center;vertical-align:middle}.summary-table thead tr:nth-child(2) th{font-size:7.5px;line-height:1.05;padding:2px 1px}.summary-table tbody td{height:7mm}.summary-table tfoot td{font-weight:700}.summary-table .row-label-summary{line-height:1.3;white-space:normal}.summary-table .summary-total-money{vertical-align:middle;text-align:center}.summary-table .meta-summary{line-height:1.35;padding-top:5px;padding-bottom:5px;white-space:normal}.summary-table .meta-summary span{display:block}.summary-table .meta-summary-empty{background:#fff}.summary-table .col-date{width:8.4%;min-width:8.4%;max-width:8.4%}.summary-table .col-group{width:1.526667%}.summary-table .column-empty{color:transparent}.summary-table .group-empty-cell{background:#fff}.note-line{border:1px solid #000;border-top:0;min-height:30px;padding:5px 6px}.sign-table td{height:12mm;vertical-align:top;padding-top:4px}.page-footer{margin-top:4px;text-align:center;font-size:9px;font-weight:700}.num,.money{font-variant-numeric:tabular-nums}.money{white-space:nowrap}@media print{body{font-size:8px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.meta-table td,.summary-table th,.summary-table td,.sign-table td{padding:2px 3px}.summary-table thead tr:nth-child(2) th{font-size:7.1px;padding:1px 1px}.summary-table tbody td{height:6.5mm}.summary-table .meta-summary{padding-top:4px;padding-bottom:4px}}"""


def document_html(title, styles, body):
    return f'<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>{h(title)}</title><style>{styles}</style></head><body>{body}</body></html>'


def document_number_for(statement):
    source = "QS" if "quantity_sheet" in str(statement.get("sourceType") or "") else "CM"
    identifier = "".join(
        char for char in str(statement.get("id") or "PREVIEW") if char.isalnum() or char == "-"
    ).upper()
    return f"CL-{source}-{str(statement.get('month') or '').replace('-', '')}-{identifier}"


def format_quantity_change(count, change_type, transfer, transfer_type):
    value = as_number(count)
    if not value:
        return ""
    short = {"购入": "购", "转入": "转", "分笼": "分", "取材": "取", "死亡": "死", "转出": "转"}.get(
        str(change_type or ""), str(change_type or "")
    )
    suffix = f" {transfer}" if change_type == transfer_type and transfer else ""
    return f"{number_text(value)}（{short}{suffix}）" if short else number_text(value)


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
    return h(value)


def month_label(value):
    text = str(value or "")
    return f"{text[:4]}年{text[5:7]}月" if len(text) >= 7 else "未命名月份"


def normalize_iacuc(value):
    return str(value or "").strip().upper()


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
