import io
import unittest

from openpyxl import load_workbook

from server_app.domains.billing.settlement_xlsx import build_settlement_workbook


def standard_item(iacuc, count, free, tier1, tier2, **overrides):
    item = {
        "iacuc": iacuc,
        "species": "mouse",
        "billingItem": "mouse_standard",
        "billingUnit": "cage_day",
        "cageCount": count,
        "animalCount": 0,
        "statementUnitPrice": 1.0,
        "statementOverageUnitPrice": 1.5,
        "statementTiered": True,
        "statementFreeAllowance": True,
        "statementFullExemption": False,
        "tiered": True,
        "freeAllowance": True,
        "fullExemption": False,
        "freeCages": free,
        "tier1BillableCages": tier1,
        "tier2BillableCages": tier2,
        "supportAmount": 0.0,
        "payableAmount": 0.0,
        "unitPrice": 1.0,
        "overageUnitPrice": 1.5,
        "customBilling": False,
    }
    item.update(overrides)
    return item


def sample_entry(include_custom=False):
    statement = {
        "id": "stmt-1",
        "iacuc": "pi::李教授",
        "iacucs": ["Z1", "Z2"],
        "month": "2026-07",
        "project": "样本课题",
        "pi": "李教授",
        "owner": "张三",
        "funding": "F-1",
        "sourceType": "pi_merged_quantity_sheet",
        "billingUnit": "cage_day",
        "freeCageAllowance": 20,
        "tierLimit": 160,
        "baseUnitPrice": 1.0,
        "overageUnitPrice": 1.5,
        "totalCageDays": 18,
        "totalAmount": 16.5,
        "notes": "",
    }
    day_one_breakdown = [
        standard_item("Z1", 6, 2, 4, 0),
        standard_item("Z2", 4, 0, 4, 0),
    ]
    if include_custom:
        day_one_breakdown.append(
            standard_item(
                "Z1",
                0,
                0,
                0,
                0,
                customBilling=True,
                cageCount=2,
                unitPrice=2.0,
                statementUnitPrice=1.0,
                customBillingStartDate="2026-07-01",
                customBillingEndDate="2026-07-01",
                customBillingNote="临时加收",
            )
        )
    lines = [
        {
            "date": "2026-07-01",
            "cageCount": 12,
            "amount": 12.0,
            "cumulative": 12.0,
            "iacucBreakdown": day_one_breakdown,
        },
        {
            "date": "2026-07-02",
            "cageCount": 8,
            "amount": 8.5,
            "cumulative": 20.5,
            "iacucBreakdown": [
                standard_item("Z1", 5, 0, 5, 0),
                standard_item("Z2", 3, 0, 2, 1),
            ],
        },
        {
            "date": "2026-07-03",
            "cageCount": 0,
            "amount": 0.0,
            "cumulative": 20.5,
            "iacucBreakdown": [],
        },
    ]
    return statement, lines


class SettlementXlsxTests(unittest.TestCase):
    def test_workbook_contains_formula_amount_cells_and_totals(self):
        workbook = load_workbook(
            io.BytesIO(build_settlement_workbook([sample_entry()])),
        )
        worksheet = workbook["李教授 2026-07 结算单"]

        self.assertIn("李教授", str(worksheet["A1"].value))
        amount_formula_cells = [
            cell
            for row in worksheet.iter_rows()
            for cell in row
            if isinstance(cell.value, str)
            and cell.value.startswith("=ROUND(")
            and not cell.value.startswith("=ROUND(D")
        ]
        # 2 天 × 2 个 IACUC 列的每日金额公式
        self.assertEqual(len(amount_formula_cells), 4)
        for cell in amount_formula_cells:
            self.assertRegex(str(cell.value), r"^=ROUND\(\(?[A-Z]+\d+")

        payable_label = [
            cell for row in worksheet.iter_rows() for cell in row if cell.value == "本月待缴纳饲养费总计（元）"
        ][0]
        payable_cell = [
            cell
            for cell in worksheet[payable_label.row]
            if isinstance(cell.value, str) and cell.value.startswith("=SUM(")
        ][0]
        self.assertTrue(str(payable_cell.value).startswith("=SUM("))
        self.assertNotIn("+", str(payable_cell.value))

        totals_row = [cell for row in worksheet.iter_rows() for cell in row if cell.value == "单项合计"][0].row
        self.assertTrue(str(worksheet.cell(totals_row, 2).value).startswith("=SUM("))
        self.assertNotIn(
            "—",
            [worksheet.cell(totals_row, column).value for column in range(2, worksheet.max_column + 1)],
        )

    def test_custom_billing_uses_quantity_times_price_formula(self):
        workbook = load_workbook(
            io.BytesIO(build_settlement_workbook([sample_entry(include_custom=True)])),
        )
        worksheet = workbook["李教授 2026-07 结算单"]

        custom_amounts = [
            cell
            for row in worksheet.iter_rows()
            for cell in row
            if isinstance(cell.value, str) and cell.value == f"=ROUND(D{cell.row}*E{cell.row},2)"
        ]
        self.assertEqual(len(custom_amounts), 1)

        payable_label = [
            cell for row in worksheet.iter_rows() for cell in row if cell.value == "本月待缴纳饲养费总计（元）"
        ][0]
        payable_cell = [
            cell
            for cell in worksheet[payable_label.row]
            if isinstance(cell.value, str) and cell.value.startswith("=SUM(")
        ][0]
        # 自定义金额已包含在每日列金额中，应付总计不得再加自定义合计（避免重复计入）
        self.assertNotIn("+", str(payable_cell.value))
        self.assertIn("自定义收费明细", str(worksheet.cell(payable_label.row + 2, 1).value))


if __name__ == "__main__":
    unittest.main()
