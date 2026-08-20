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
from server_app.pdf.documents import billing_statement_html, quantity_sheet_html


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

    def test_settlement_html_groups_iacucs_under_species_headers(self):
        statement = {
            "id": "species-summary",
            "month": "2026-06",
            "pi": "张教授",
            "sourceType": "pi_merged_quantity_sheet",
            "billingUnit": "mixed",
            "iacucs": ["R1", "Z1", "M1"],
            "notes": "Z1 将于 2026-07-01 到期。",
        }
        lines = [
            {
                "date": "2026-06-01",
                "animalCount": 1,
                "cageCount": 8,
                "amount": 58.5,
                "iacucBreakdown": [
                    {
                        "iacuc": "R1",
                        "species": "rat",
                        "cageCount": 2,
                        "payableAmount": 17,
                        "billingUnit": "cage_day",
                        "unitPrice": 8.5,
                    },
                    {
                        "iacuc": "Z1",
                        "species": "mouse",
                        "cageCount": 6,
                        "freeCages": 2,
                        "payableAmount": 18,
                        "billingUnit": "cage_day",
                        "unitPrice": 4.5,
                        "statementOverageUnitPrice": 6.5,
                        "statementTiered": True,
                        "overageUnitPrice": 6.5,
                        "tiered": True,
                    },
                    {
                        "iacuc": "M1",
                        "species": "monkey",
                        "animalCount": 1,
                        "payableAmount": 23.5,
                        "billingUnit": "animal_day",
                        "unitPrice": 23.5,
                    },
                ],
            }
        ]
        html = billing_statement_html(statement, lines)
        self.assertIn("<h1>张教授课题组实验动物饲养费核算汇总表</h1>", html)
        self.assertIn('rowspan="3">日期', html)
        self.assertIn('colspan="24">小鼠', html)
        self.assertIn('colspan="12">大鼠', html)
        self.assertIn('colspan="12">猴', html)
        self.assertIn('colspan="12">汇总', html)
        self.assertIn('colspan="6">只数', html)
        self.assertIn("收费标准：", html)
        self.assertEqual(html.count('class="note-detail"'), 2)
        self.assertIn("伦理到期提示：", html)
        self.assertIn("Z1 将于 2026-07-01 到期。", html)
        self.assertIn("height:6.5mm", html)
        self.assertIn(".summary-table tr>:last-child{border-right:1px solid #000}", html)
        self.assertIn("1）小鼠 4.5元/笼/日、2）大鼠 8.5元/笼/日、3）猴 23.5元/只/日", html)
        self.assertNotIn("笼位数＞160", html)

    def test_custom_billing_details_are_rendered_in_quantity_and_settlement_notes(self):
        sheet = {
            "id": "custom-sheet",
            "month": "2026-07",
            "iacuc": "Z-RABBIT",
            "pi": "张教授",
            "billingUnit": "animal_day",
            "customBillingSegments": [
                {
                    "id": "special-feed",
                    "startDate": "2026-07-10",
                    "endDate": "2026-07-20",
                    "quantity": 5,
                    "unitPrice": 12,
                    "note": "特殊饲料",
                }
            ],
            "rows": [],
        }
        statement = {"id": "statement", "month": "2026-07", "pi": "张教授", "sourceType": "quantity_sheet"}
        lines = [
            {
                "date": "2026-07-10",
                "iacucBreakdown": [
                    {
                        "iacuc": "Z-RABBIT",
                        "animalCount": 5,
                        "billingItem": "兔饲养费",
                        "billingUnit": "animal_day",
                        "unitPrice": 12,
                        "customBilling": True,
                        "customBillingSegmentId": "special-feed",
                        "customBillingStartDate": "2026-07-10",
                        "customBillingEndDate": "2026-07-20",
                        "customBillingNote": "特殊饲料",
                        "payableAmount": 60,
                    }
                ],
            }
        ]
        self.assertIn("自定义收费明细", quantity_sheet_html(sheet))
        statement_html = billing_statement_html(statement, lines)
        self.assertIn("自定义收费：", statement_html)
        self.assertIn("特殊饲料", statement_html)
        self.assertIn("每日5只，12元/只/日，本月共计60元", statement_html)
        self.assertNotIn("<h1>自定义收费明细</h1>", statement_html)
