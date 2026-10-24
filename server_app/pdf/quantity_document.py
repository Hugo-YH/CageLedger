"""Quantity calendar projection and printable quantity-sheet layout."""

from server_app.domains.billing.custom_billing import normalize_custom_billing_segments
from server_app.pdf.formatting import day_index, days_in_month, format_date, month_label

from .document_formatting import as_number, clean_filename, document_html, h, number_text, number_text_or_blank
from .settlement_document_layout import PRINT_ROWS


def quantity_sheet_filename(sheet):
    return f"实验动物数量统计表 {month_label(sheet.get('month'))} {clean_filename(sheet.get('iacuc'))}.pdf"


def quantity_sheet_html(sheet):
    rows = quantity_sheet_pages(sheet)
    pages = "".join(quantity_page_markup(sheet, page, index) for index, page in enumerate(rows))
    pages += quantity_custom_billing_details_markup(sheet)
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
    custom_segments = sheet_custom_billing_segments(sheet)
    footer = f"项目名称：{h(sheet.get('project'))}"
    if sheet.get("fullExemption"):
        footer += "　减免方式：全额减免"
    if custom_segments:
        footer += f"　自定义收费 {len(custom_segments)} 条，详见附页"
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


def sheet_custom_billing_segments(sheet):
    segments = sheet.get("customBillingSegments")
    if isinstance(segments, list):
        return segments
    return normalize_custom_billing_segments(sheet, str(sheet.get("month") or ""))


def quantity_custom_billing_details_markup(sheet):
    segments = sheet_custom_billing_segments(sheet)
    if not segments:
        return ""
    unit = "只/天" if sheet.get("billingUnit") == "animal_day" else "笼/天"
    rows = "".join(
        f'<tr><td>{index}</td><td>{h(format_date(segment.get("startDate")))}</td><td>{h(format_date(segment.get("endDate")))}</td><td class="num">{number_text_or_blank(segment.get("quantity")) if segment.get("quantity") is not None else "全部"}</td><td class="money">¥{as_number(segment.get("unitPrice")):.2f} / {unit}</td><td>{h(segment.get("note") or "-")}</td></tr>'
        for index, segment in enumerate(segments, start=1)
    )
    return f"""<section class="sheet-page custom-billing-details">
<div class="sheet-topline">中山大学中山眼科中心 实验动物中心</div>
<h2>自定义收费明细</h2><p>IACUC：{h(sheet.get("iacuc"))}　项目负责人：{h(sheet.get("pi"))}</p>
<table class="custom-billing-table"><thead><tr><th>序号</th><th>开始日期</th><th>结束日期</th><th>每日数量</th><th>收费标准</th><th>收费说明</th></tr></thead><tbody>{rows}</tbody></table>
<p class="custom-billing-note">自定义收费数量按每日实际结余核算，独立于减免和梯度收费。</p></section>"""


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


def quantity_styles():
    return """@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#000;background:#fff;font-family:"Arial","Helvetica Neue","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:9px}.sheet-page{min-height:276mm;page-break-after:always}.sheet-page:last-child{page-break-after:auto}.sheet-topline{font-size:8px;margin-bottom:4px}.sheet-table,.custom-billing-table{border-collapse:collapse;width:100%;table-layout:fixed}.sheet-table th,.sheet-table td,.custom-billing-table th,.custom-billing-table td{border:1px solid #000;padding:3px 4px;text-align:center;vertical-align:middle;word-break:break-all}.sheet-table .title{font-size:18px;padding:8px 0;font-weight:700}.sheet-table .note{color:#c80000;font-weight:700;text-align:left;line-height:1.35}.sheet-table .meta,.sheet-table .label,.sheet-table .footer-row{font-weight:700}.sheet-table .footer-row{text-align:left;height:26px}.sheet-table .num,.custom-billing-table .num{font-variant-numeric:tabular-nums}.custom-billing-details h2{font-size:18px;margin:8px 0}.custom-billing-details p{margin:5px 0}.custom-billing-table th{font-weight:700;background:#f1f5f4}.custom-billing-table td{height:9mm}.custom-billing-note{margin-top:8px!important;line-height:1.5}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}"""


def format_quantity_change(count, change_type, transfer, transfer_type):
    value = as_number(count)
    if not value:
        return ""
    short = {"购入": "购", "转入": "转", "分笼": "分", "取材": "取", "死亡": "死", "转出": "转"}.get(
        str(change_type or ""), str(change_type or "")
    )
    suffix = f" {transfer}" if change_type == transfer_type and transfer else ""
    return f"{number_text(value)}（{short}{suffix}）" if short else number_text(value)


LEFT_COLUMN_DAYS = 15
