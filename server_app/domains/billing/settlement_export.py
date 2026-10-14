"""Worksheet dispatch preserves the established feeding workbook formatter."""

import io

from openpyxl import Workbook

from server_app.domains.technical_services.xlsx import write_statement_sheet

from .settlement_xlsx import _sanitize_sheet_name, _write_statement_sheet
from .settlement_xlsx import build_settlement_workbook as build_feeding_workbook


def build_settlement_workbook(entries):
    if all(statement.get("sourceType") != "pi_merged_technical_service" for statement, _ in entries):
        return build_feeding_workbook(entries)
    workbook = Workbook()
    workbook.remove(workbook.active)
    for statement, lines in entries:
        kind = "技术服务费" if statement.get("sourceType") == "pi_merged_technical_service" else "饲养费"
        sheet = workbook.create_sheet(_sanitize_sheet_name(f"{statement['pi']} {statement['month']} {kind}"))
        if kind == "技术服务费":
            write_statement_sheet(sheet, statement)
        else:
            _write_statement_sheet(sheet, statement, lines)
    workbook.calculation.fullCalcOnLoad = True
    workbook.calculation.forceFullCalc = True
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()
