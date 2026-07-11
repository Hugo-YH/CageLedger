import io
import unittest
import zipfile

from server_app.pdf import (
    billing_statement_filename,
    build_pdf_zip,
    quantity_sheet_filename,
    render_billing_statement_pdf,
    render_quantity_sheet_pdf,
)


class PdfExportTests(unittest.TestCase):
    def test_quantity_pdf_keeps_calendar_balances_and_blank_handlers(self):
        sheet = {
            "id": "sheet-1",
            "month": "2026-06",
            "roomName": "8101",
            "manager": "登记人员",
            "roomManager": "房间管理员",
            "iacuc": "Z2026001",
            "pi": "张教授",
            "owner": "陈老师",
            "project": "项目",
            "pageCount": 1,
            "billingUnit": "cage_day",
            "animalDetailEnabled": False,
            "rows": [
                {
                    "date": "2026-06-01",
                    "addedCount": None,
                    "removedCount": None,
                    "animalCount": None,
                    "cageCount": 7,
                }
            ],
        }
        pdf = render_quantity_sheet_pdf(sheet)
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertEqual(quantity_sheet_filename(sheet), "实验动物数量统计表 2026年06月 Z2026001.pdf")

    def test_settlement_pdf_and_zip_keep_distinct_documents(self):
        statement = {
            "id": "statement-1",
            "month": "2026-06",
            "pi": "张教授",
            "owner": "陈老师",
            "funding": "支撑经费",
            "sourceType": "pi_merged_quantity_sheet",
            "billingUnit": "cage_day",
            "iacucs": ["Z2026001"],
            "totalCageDays": 170,
            "totalAnimalDays": 0,
            "totalFreeCageDays": 20,
            "totalTier2CageDays": 10,
            "freeCageAllowance": 20,
        }
        lines = [
            {
                "date": "2026-06-01",
                "cageCount": 170,
                "animalCount": 0,
                "freeCages": 20,
                "tier2BillableCages": 10,
                "amount": 740,
                "iacucBreakdown": [
                    {
                        "iacuc": "Z2026001",
                        "cageCount": 170,
                        "freeCages": 20,
                        "tier2BillableCages": 10,
                        "billingItem": "小鼠饲养费",
                        "billingUnit": "cage_day",
                        "unitPrice": 4.5,
                        "overageUnitPrice": 6.5,
                        "tiered": True,
                        "payableAmount": 740,
                    }
                ],
            }
        ]
        pdf = render_billing_statement_pdf(statement, lines)
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertEqual(billing_statement_filename(statement), "张教授课题组实验动物饲养费核算汇总表 2026年06月.pdf")
        bundle = build_pdf_zip([("张教授.pdf", pdf), ("张教授.pdf", pdf)])
        with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
            self.assertEqual(archive.namelist(), ["张教授.pdf", "张教授 (2).pdf"])
            self.assertTrue(archive.read("张教授.pdf").startswith(b"%PDF"))
