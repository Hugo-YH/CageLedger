"""Settlement pagination and grouped table layout."""

from .document_formatting import as_number, document_number_for, h, number_text
from .settlement_document_model import empty_summary, unit_display


def settlement_pages(columns):
    first = columns[:4]
    pages = [{"slots": first + [None] * (4 - len(first)), "leading": any(item["species"] == "小鼠" for item in first)}]
    rest = columns[4:]
    for index in range(0, len(rest), 5):
        chunk = rest[index : index + 5]
        pages.append({"slots": chunk + [None] * (5 - len(chunk)), "leading": False})
    return pages


def settlement_page_markup(
    statement,
    rows,
    page,
    summaries,
    mouse_column_keys,
    unit,
    total_count,
    total_free,
    total_tier,
    total_payable,
    page_index,
    total_pages,
    note_markup,
):
    slots = page["slots"]
    page_mouse_keys = [slot["key"] for slot in slots if slot and slot["species"] == "小鼠"]
    summary_mouse_keys = mouse_column_keys if page["leading"] else page_mouse_keys
    mouse_summaries = [summaries[key] for key in summary_mouse_keys]
    mouse_total_count = sum(item["count"] for item in mouse_summaries)
    mouse_total_free = sum(item["free"] for item in mouse_summaries)
    mouse_total_tier = sum(item["tier"] for item in mouse_summaries)
    mouse_total_payable = sum(item["amount"] for item in mouse_summaries)
    page_has_free = (mouse_total_free > 0 if page["leading"] else False) or any(
        slot and summaries[slot["key"]]["free"] > 0 for slot in slots
    )
    page_has_tier = (mouse_total_tier > 0 if page["leading"] else False) or any(
        slot and summaries[slot["key"]]["tier"] > 0 for slot in slots
    )
    title = f"{h(statement.get('pi') or '-')}课题组实验动物饲养费核算汇总表"
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
    species_headers = species_group_headers(slots, page["leading"])
    leading_sub = (
        group_headers("笼数", page_has_free, page_has_tier, mouse_total_payable >= 100) if page["leading"] else ""
    )
    sub_headers = "".join(
        group_headers(
            "" if not slot else ("只数" if slot["unit"] == "animal_day" else "笼数"),
            slot["showFree"] if slot else False,
            slot["showTiered"] if slot else False,
            slot["needsWideAmount"] if slot else False,
        )
        for slot in slots
    )
    detail_rows = []
    for row in rows:
        leading_values = (
            group_cells(
                {
                    "count": sum(row["values"][key]["count"] for key in summary_mouse_keys),
                    "free": sum(row["values"][key]["free"] for key in summary_mouse_keys),
                    "tier": sum(row["values"][key]["tier"] for key in summary_mouse_keys),
                    "amount": sum(row["values"][key]["amount"] for key in summary_mouse_keys),
                },
                page_has_free,
                page_has_tier,
                True,
                mouse_total_payable >= 100,
            )
            if page["leading"]
            else ""
        )
        values = "".join(
            group_cells(
                row["values"].get(slot["key"], empty_summary()),
                slot["showFree"],
                slot["showTiered"],
                True,
                slot["needsWideAmount"],
            )
            if slot
            else f'<td colspan="{GROUP_UNITS}" class="group-empty-cell"></td>'
            for slot in slots
        )
        detail_rows.append(f"<tr><td>{h(row['date'])}</td>{leading_values}{values}</tr>")
    total_values = "".join(
        group_cells(summaries[slot["key"]], slot["showFree"], slot["showTiered"], True, slot["needsWideAmount"])
        if slot
        else f'<td colspan="{GROUP_UNITS}" class="group-empty-cell"></td>'
        for slot in slots
    )
    leading_totals = (
        group_cells(
            {
                "count": mouse_total_count,
                "free": mouse_total_free,
                "tier": mouse_total_tier,
                "amount": mouse_total_payable,
            },
            page_has_free,
            page_has_tier,
            True,
            mouse_total_payable >= 100,
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
<table class="summary-table"><colgroup><col class="col-date">{leading_cols}{columns_cols}</colgroup><thead><tr><th class="date-column" rowspan="3">日期</th>{species_headers}</tr><tr>{leading_header}{headers}</tr><tr>{leading_sub}{sub_headers}</tr></thead><tbody>{"".join(detail_rows)}</tbody><tfoot><tr><td class="row-label">单项合计</td>{leading_totals}{total_values}</tr><tr>{leading_summary}{meta_summary}</tr></tfoot></table>
{note_markup}<table class="sign-table"><tbody><tr><td>项目负责人</td><td>实验负责人/经办人</td><td>日期</td></tr></tbody></table><div class="page-footer">第{page_index + 1}页 共{total_pages}页</div></main>"""


def species_group_headers(slots, has_mouse_summary):
    groups = []
    for slot in slots:
        species = slot["species"] if slot else ""
        if groups and groups[-1]["species"] == species:
            groups[-1]["span"] += GROUP_UNITS
        else:
            groups.append({"species": species, "span": GROUP_UNITS})
    if has_mouse_summary and groups and groups[0]["species"] == "小鼠":
        groups[0]["span"] += GROUP_UNITS
    elif has_mouse_summary:
        groups.insert(0, {"species": "小鼠", "span": GROUP_UNITS})
    return "".join(
        f'<th colspan="{group["span"]}" class="column-empty"></th>'
        if not group["species"]
        else f'<th colspan="{group["span"]}">{h(group["species"])}</th>'
        for group in groups
    )


def group_headers(count_label, show_free, show_tier, needs_wide_amount=False):
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
            for label, span in zip(labels, group_field_spans(show_free, show_tier, needs_wide_amount), strict=False)
        )
        if labels
        else f'<th colspan="{GROUP_UNITS}"></th>'
    )


def group_cells(summary, show_free, show_tier, show_amount, needs_wide_amount=False):
    has_count = as_number(summary.get("count")) > 0 or bool(summary.get("hasRecord"))

    def text_value(key):
        value = as_number(summary.get(key))
        if has_count:
            return str(int(value)) if value.is_integer() else str(value)
        return number_text(value)

    cells = [("num", text_value("count"))]
    if show_free:
        cells.append(("num", text_value("free")))
    if show_tier:
        cells.append(("num", text_value("tier")))
    if show_amount:
        has_value = has_count or any(as_number(summary.get(key)) > 0 for key in ("count", "free", "tier", "amount"))
        cells.append(("money", f"{as_number(summary.get('amount')):.2f}" if has_value else ""))
    return "".join(
        f'<td colspan="{span}" class="{class_name}{"" if value else " group-empty-cell"}">{value}</td>'
        for (class_name, value), span in zip(
            cells, group_field_spans(show_free, show_tier, needs_wide_amount), strict=False
        )
    )


def group_field_spans(show_free, show_tier, needs_wide_amount=False):
    """伦理列子字段默认均分（四等分/三等分/二等分），保证同名字段在各列宽度一致；
    当该列金额较大时给金额列多借 1 单位（从减免/梯度列扣），避免大额数字溢出。"""
    parts = 1 + (1 if show_free else 0) + (1 if show_tier else 0) + 1
    base, remainder = divmod(GROUP_UNITS, parts)
    spans = [base + (1 if index < remainder else 0) for index in range(parts)]
    if needs_wide_amount and parts >= 3:
        spans[-1] += 1
        for index in range(1, parts - 1):
            if spans[index] > 1:
                spans[index] -= 1
                break
    return spans


GROUP_UNITS = 12


PRINT_ROWS = 16
