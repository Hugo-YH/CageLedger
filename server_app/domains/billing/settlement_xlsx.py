"""项目负责人结算单 Excel 导出，版式与打印/PDF 汇总表保持一致。

表格结构与 PDF 相同：标题、信息区、汇总块 + 按 IACUC 分列（笼数/数量、减免、阶梯、金额）、
单项合计、本月待缴纳总计、自定义收费明细与签字区。

每日金额在列不含自定义收费时写为公式 = (笼数-减免-阶梯) × 基础价 + 阶梯 × 超额价；
含自定义收费的列金额为引擎计算值（与 PDF 数字一致），自定义部分在附表按 数量 × 单价 公式单独核对。
合计与总计全部使用 SUM 公式，打开文件时强制重算。"""

import io

from openpyxl import Workbook

from .settlement_xlsx_layout import _BODY_FONT as _BODY_FONT
from .settlement_xlsx_layout import _BORDER as _BORDER
from .settlement_xlsx_layout import _CUSTOM_FILL as _CUSTOM_FILL
from .settlement_xlsx_layout import _HEADER_FILL as _HEADER_FILL
from .settlement_xlsx_layout import _HEADER_FONT as _HEADER_FONT
from .settlement_xlsx_layout import _INTEGER_FORMAT as _INTEGER_FORMAT
from .settlement_xlsx_layout import _MONEY_FORMAT as _MONEY_FORMAT
from .settlement_xlsx_layout import _THIN as _THIN
from .settlement_xlsx_layout import _TITLE_FONT as _TITLE_FONT
from .settlement_xlsx_layout import _TOTAL_FILL as _TOTAL_FILL
from .settlement_xlsx_layout import _write_custom_appendix as _write_custom_appendix
from .settlement_xlsx_layout import _write_statement_sheet as _write_statement_sheet
from .settlement_xlsx_model import _SPECIES_LABELS as _SPECIES_LABELS
from .settlement_xlsx_model import _SPECIES_ORDER as _SPECIES_ORDER
from .settlement_xlsx_model import _UNIT_LABELS as _UNIT_LABELS
from .settlement_xlsx_model import _amount_formula as _amount_formula
from .settlement_xlsx_model import _as_int as _as_int
from .settlement_xlsx_model import _as_money as _as_money
from .settlement_xlsx_model import _column_key as _column_key
from .settlement_xlsx_model import _count_label as _count_label
from .settlement_xlsx_model import _custom_range as _custom_range
from .settlement_xlsx_model import _leading_count_label as _leading_count_label
from .settlement_xlsx_model import _sanitize_sheet_name as _sanitize_sheet_name
from .settlement_xlsx_model import _species_label as _species_label
from .settlement_xlsx_model import _statement_columns as _statement_columns
from .settlement_xlsx_model import _statement_rows as _statement_rows


def build_settlement_workbook(entries):
    """entries: [(statement, lines), ...]"""
    workbook = Workbook()
    workbook.remove(workbook.active)
    for statement, lines in entries:
        pi = str(statement.get("pi") or "-")
        month = str(statement.get("month") or "")
        sheet_name = _sanitize_sheet_name(f"{pi} {month} 结算单")
        _write_statement_sheet(workbook.create_sheet(sheet_name), statement, lines)
    workbook.calculation.fullCalcOnLoad = True
    workbook.calculation.forceFullCalc = True
    output = io.BytesIO()
    workbook.save(output)
    output.seek(0)
    return output.getvalue()
