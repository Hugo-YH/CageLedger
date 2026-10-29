import io
import re
from collections import defaultdict
from datetime import date

try:
    from openpyxl import Workbook
    from openpyxl.cell import Cell
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
except ImportError:  # pragma: no cover - deployment dependency validation
    Workbook = None

from server_app.domains.iacuc import normalize_application_date, normalize_iacuc_number
from server_app.shared import clean_text
from server_app.shared.xlsx import set_literal_cell

from .allowance import billing_free_cages_for_pi
from .profiles import billing_profile_for_room
from .statements import quantity_sheet_statement_lines

MONTH_PATTERN = re.compile(r"\d{4}-\d{2}\Z")
EXCEL_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
FACILITY_LABELS = {
    "zhujiang": "珠江新城",
    "bioisland": "生物岛",
}
SPECIES_LABELS = {
    "mouse": "小鼠",
    "mouse_standard": "小鼠",
    "mouse_diabetic": "小鼠",
    "rat": "大鼠",
    "rat_standard": "大鼠",
    "rat_diabetic": "大鼠",
    "guinea_pig": "豚鼠",
    "rabbit": "兔",
    "monkey": "猴",
    "pig": "猪",
    "dog": "犬",
}


def build_pi_reimbursement_context(workflows):
    """仅取单据跟踪交回登记/补录的报销单信息，无登记单时全部为空。"""
    forms = []
    notes = []
    statement_returned = False
    for workflow in workflows or []:
        forms.extend(workflow.get("reimbursementForms") or [])
        note = clean_text(workflow.get("reimbursementFormNote", ""))
        if note and note not in notes:
            notes.append(note)
        if workflow.get("signedStatementReturned"):
            statement_returned = True
    if not forms and not statement_returned and not notes:
        return {
            "statementReturned": "",
            "fundBookNo": "",
            "reimbursementFormNo": "",
            "reimbursementAmount": 0.0,
            "notes": "",
        }
    forms = list(
        {
            (
                clean_text(entry.get("formNo", "")),
                clean_text(entry.get("fundingBookNo", "")),
                entry.get("amount", 0),
            ): entry
            for entry in forms
        }.values()
    )
    fund_book_nos = [
        clean_text(entry.get("fundingBookNo", "")) for entry in forms if clean_text(entry.get("fundingBookNo", ""))
    ]
    form_nos = [clean_text(entry.get("formNo", "")) for entry in forms if clean_text(entry.get("formNo", ""))]
    return {
        "statementReturned": "已交回" if statement_returned else "",
        "fundBookNo": "、".join(dict.fromkeys(fund_book_nos)),
        "reimbursementFormNo": "、".join(dict.fromkeys(form_nos)),
        "reimbursementAmount": round(sum(float(entry.get("amount") or 0) for entry in forms), 2),
        "notes": "；".join(notes),
    }


def build_monthly_summary_rows(
    month,
    sheets,
    rooms,
    applications_by_iacuc,
    principal_type_by_pi,
    reimbursement_by_pi,
    *,
    frozen_lines_by_pi=None,
):
    """Build monthly export rows from the same daily breakdown used by PI settlement."""
    if not MONTH_PATTERN.fullmatch(str(month or "")):
        raise ValueError("结算月份格式应为 YYYY-MM")

    room_by_id = {room.get("id"): room for room in rooms or []}
    contexts = {}
    sheets_by_pi = defaultdict(list)
    errors = []
    for sheet in sheets or []:
        pi_name = clean_text(sheet.get("pi", ""))
        iacuc = normalize_iacuc_number(sheet.get("iacuc", ""))
        if not pi_name or not iacuc:
            errors.append(
                f"项目负责人 {pi_name or '未填写'} / IACUC {iacuc or '未填写'}："
                f"缺少{'项目负责人' if not pi_name else 'IACUC 编号'}"
            )
            continue
        room = room_by_id.get(sheet.get("roomId")) or next(
            (item for item in rooms or [] if clean_text(item.get("name")) == clean_text(sheet.get("roomName"))), {}
        )
        profile = billing_profile_for_room(room or {}, sheet.get("billingUnit"))
        key = (pi_name, iacuc, clean_text(profile.get("facility")) or "未设置设施")
        current = contexts.setdefault(
            key,
            {
                "pi": pi_name,
                "iacuc": iacuc,
                "facility": _facility_label(key[2]),
                "species": set(),
                "roomNames": set(),
                "amount": 0.0,
                "supportAmount": 0.0,
                "payableAmount": 0.0,
                "expiredAllowance": {},
            },
        )
        species = _species_label(clean_text(room.get("defaultSpecies")) or clean_text(profile.get("species")))
        if species:
            current["species"].add(species)
        if clean_text(sheet.get("roomName")):
            current["roomNames"].add(clean_text(sheet.get("roomName")))
        sheets_by_pi[pi_name].append(sheet)

    for pi_name, pi_sheets in sheets_by_pi.items():
        free_cages = billing_free_cages_for_pi(principal_type_by_pi, pi_name)
        lines = (frozen_lines_by_pi or {}).get(pi_name)
        if lines is None:
            lines = quantity_sheet_statement_lines(pi_sheets, free_cages, rooms, applications_by_iacuc)
        for line in lines:
            for item in line.get("iacucBreakdown", []):
                iacuc = normalize_iacuc_number(item.get("iacuc", ""))
                facility = clean_text(item.get("facility")) or "未设置设施"
                key = (pi_name, iacuc, facility)
                current = contexts.get(key)
                if current is None:
                    continue
                current["amount"] += float(item.get("amount") or 0)
                current["supportAmount"] += float(item.get("supportAmount") or 0)
                current["payableAmount"] += float(item.get("payableAmount") or 0)
                expiry = clean_text(item.get("freeAllowanceExpiryDate"))
                if expiry:
                    current["expiredAllowance"].setdefault(iacuc, (expiry, line.get("date", "")))

    if errors:
        raise ValueError("；".join(sorted(set(errors))))

    rows = []
    for current in contexts.values():
        application = applications_by_iacuc.get(current["iacuc"], {})
        reimbursement = reimbursement_by_pi.get(current["pi"], {})
        rows.append(
            {
                "pi": current["pi"],
                "facility": current["facility"],
                "iacuc": current["iacuc"],
                "funding": clean_text(application.get("funding", "")),
                "species": "、".join(sorted(current["species"])),
                "amount": round(current["amount"], 2),
                "supportAmount": round(current["supportAmount"], 2),
                "payableAmount": round(current["payableAmount"], 2),
                "statementReturned": clean_text(reimbursement.get("statementReturned", "")),
                "fundBookNo": clean_text(reimbursement.get("fundBookNo", "")),
                "reimbursementFormNo": clean_text(reimbursement.get("reimbursementFormNo", "")),
                "reimbursementAmount": round(float(reimbursement.get("reimbursementAmount") or 0), 2),
                "reimbursementNotes": clean_text(reimbursement.get("notes", "")),
                "projectStartDate": normalize_application_date(application.get("projectStartDate", "")),
                "projectEndDate": normalize_application_date(application.get("projectEndDate", "")),
                "notes": _expired_allowance_note(current["expiredAllowance"], month),
                "roomNames": "、".join(sorted(current["roomNames"])),
            }
        )
    return sorted(rows, key=lambda item: (item["pi"], item["facility"], item["iacuc"]))


def build_monthly_summary_xlsx(month, rows):
    if Workbook is None:
        raise ValueError("当前运行环境缺少 Excel 导出依赖 openpyxl")
    year, month_number = month.split("-")
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Sheet1"
    worksheet.sheet_view.showGridLines = False
    worksheet.merge_cells("A1:S1")
    worksheet["A1"] = f"{year}年{int(month_number)}月实验动物费用汇总"
    worksheet["A1"].font = Font(name="Microsoft YaHei", size=14, bold=True)
    worksheet["A1"].alignment = Alignment(horizontal="center", vertical="center")
    worksheet.row_dimensions[1].height = 28

    headers = [
        "序号",
        "项目负责人",
        "设施",
        "IACUC编号",
        "伦理对应的经费",
        "动物品系",
        f"{int(month_number)}月1日至{_month_days(month)}日产生的饲养费（元）",
        "单位支持的饲养费（元）",
        "缴纳的饲养费（元）",
        "结算单",
        "科研报销单经费本号",
        "科研报销单\n单号",
        "报销金额（元）",
        "报销备注",
        "实验开始时间",
        "实验结束时间",
        "备注",
        "房间号",
        "技术服务费（元）",
    ]
    header_fill = PatternFill("solid", fgColor="D9EAD3")
    thin = Side(style="thin", color="000000")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    header_font = Font(name="Microsoft YaHei", size=10, bold=True)
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for column, value in enumerate(headers, start=1):
        cell = worksheet.cell(2, column, value)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = border
    worksheet.row_dimensions[2].height = 36

    widths = [9, 13, 9, 13, 33.5, 16.25, 17, 17, 15, 10, 18.5, 19.25, 15, 20, 13.25, 16, 24, 14, 19]
    for index, width in enumerate(widths, start=1):
        worksheet.column_dimensions[_excel_column(index)].width = width

    body_font = Font(name="Microsoft YaHei", size=10)
    body_alignment = Alignment(horizontal="center", vertical="center")
    wrapped_body_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    # Cell() creates an unregistered prototype, so an empty export retains its two-row sheet shape.
    body_style_cell = Cell(worksheet, row=3, column=1)
    body_style_cell.font = body_font
    body_style_cell.border = border
    body_style_cell.alignment = body_alignment
    body_style = body_style_cell._style
    wrapped_body_style_cell = Cell(worksheet, row=3, column=5)
    wrapped_body_style_cell.font = body_font
    wrapped_body_style_cell.border = border
    wrapped_body_style_cell.alignment = wrapped_body_alignment
    wrapped_body_style = wrapped_body_style_cell._style
    numeric_body_style_cell = Cell(worksheet, row=3, column=7)
    numeric_body_style_cell.font = body_font
    numeric_body_style_cell.border = border
    numeric_body_style_cell.alignment = body_alignment
    numeric_body_style_cell.number_format = "0.00"
    numeric_body_style = numeric_body_style_cell._style
    wrapped_columns = (5, 6, 14, 17, 18)
    numeric_columns = (7, 8, 9, 13, 19)
    for index, row in enumerate(rows, start=1):
        excel_row = index + 2
        values = [
            index,
            row["pi"],
            row["facility"],
            row["iacuc"],
            row["funding"],
            row["species"],
            row["amount"],
            row["supportAmount"],
            f"=G{excel_row}-H{excel_row}",
            row["statementReturned"],
            row["fundBookNo"],
            row["reimbursementFormNo"],
            row["reimbursementAmount"],
            row["reimbursementNotes"],
            row["projectStartDate"],
            row["projectEndDate"],
            row["notes"],
            row["roomNames"],
            row.get("technicalServiceAmount", 0),
        ]
        for column, value in enumerate(values, start=1):
            cell = worksheet.cell(excel_row, column)
            if column == 9:
                cell.value = value
            else:
                set_literal_cell(cell, value)
            cell._style = (
                numeric_body_style
                if column in numeric_columns
                else wrapped_body_style
                if column in wrapped_columns
                else body_style
            )
        worksheet.row_dimensions[excel_row].height = 24

    worksheet.freeze_panes = "A3"
    worksheet.auto_filter.ref = f"A2:S{max(2, len(rows) + 2)}"
    workbook.calculation.fullCalcOnLoad = True
    workbook.calculation.forceFullCalc = True
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def monthly_summary_filename(month):
    year, month_number = month.split("-")
    return f"{year}年{int(month_number)}月实验动物费用汇总.xlsx"


def _month_days(month):
    year, month_number = (int(value) for value in month.split("-"))
    if month_number == 12:
        next_year, next_month = year + 1, 1
    else:
        next_year, next_month = year, month_number + 1
    return (date(next_year, next_month, 1) - date(year, month_number, 1)).days


def _excel_column(index):
    value = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        value = chr(65 + remainder) + value
    return value


def _facility_label(value):
    return FACILITY_LABELS.get(clean_text(value), clean_text(value))


def _species_label(value):
    return SPECIES_LABELS.get(clean_text(value), clean_text(value))


def _expired_allowance_note(items, month):
    month_start = date.fromisoformat(f"{month}-01")
    notes = []
    for iacuc, (expiry, _first_ineligible_date) in sorted((items or {}).items()):
        expiry_date = _parse_date(expiry)
        verb = "已于" if expiry_date and expiry_date < month_start else "将于"
        notes.append(f"{iacuc} {verb} {expiry} 到期")
    return "；".join(notes)


def _parse_date(value):
    try:
        return date.fromisoformat(clean_text(value))
    except ValueError:
        return None
