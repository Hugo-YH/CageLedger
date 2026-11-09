import io
import json
import unittest
import zipfile
from html.parser import HTMLParser
from pathlib import Path

from pypdf import PdfReader

from server_app.pdf import (
    billing_statement_filename,
    build_pdf_zip,
    quantity_sheet_filename,
    render_billing_statement_pdf,
    render_quantity_sheet_pdf,
)
from server_app.pdf.documents import billing_statement_html, quantity_sheet_html, statement_columns


class SettlementFooterParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.body_classes = []
        self.section = ""
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag in {"tbody", "tfoot"}:
            self.section = tag
        elif tag == "tr" and self.section == "tfoot":
            self.rows.append([])
        elif tag == "td":
            attributes = dict(attrs)
            classes = set(attributes.get("class", "").split())
            if self.section == "tfoot":
                self.cell = {"classes": classes, "text": "", "colspan": int(attributes.get("colspan", "1"))}
                self.rows[-1].append(self.cell)
            elif self.section == "tbody":
                self.body_classes.append(classes)

    def handle_endtag(self, tag):
        if tag in {"tbody", "tfoot"}:
            self.section = ""
        elif tag == "td":
            self.cell = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["text"] += data


class PdfExportTests(unittest.TestCase):
    def test_server_settlement_template_matches_shared_parity_fixture(self):
        fixture = json.loads(
            (Path(__file__).parent.parent / "src/react/print/fixtures/settlement-parity.json").read_text(
                encoding="utf-8"
            )
        )
        html = billing_statement_html(fixture["statement"], fixture["lines"])
        for expected in (
            "模板校验课题组实验动物饲养费核算汇总表",
            "Z-PARITY-MOUSE",
            "Z-PARITY-RABBIT",
            "小鼠",
            "兔",
            "单位支持：45.00",
            "实际待缴纳：45.00",
            "第1页 共1页",
        ):
            self.assertIn(expected, html)

        footer = SettlementFooterParser()
        footer.feed(html)
        self.assertEqual(len(footer.rows), 2)
        subtotal, monthly = footer.rows
        self.assertEqual(subtotal[0], {"classes": {"row-label"}, "text": "单项合计", "colspan": 1})
        summary = [cell for cell in subtotal if "summary-subtotal" in cell["classes"]]
        self.assertEqual([cell["text"] for cell in summary], ["20", "10", "45.00"])
        iacucs = [
            cell
            for cell in subtotal[1:]
            if "summary-subtotal" not in cell["classes"] and "group-empty-cell" not in cell["classes"]
        ]
        self.assertEqual([cell["text"] for cell in iacucs], ["20", "10", "45.00", "3", "45.00"])
        self.assertTrue(all(cell["classes"] in ({"num"}, {"money"}) for cell in iacucs))
        self.assertEqual(monthly[0]["classes"], {"row-label", "row-label-summary"})
        self.assertEqual(monthly[0]["text"], "本月待缴纳饲养费总计（元）")
        self.assertEqual(monthly[0]["colspan"], 3)
        self.assertEqual(monthly[1], {"classes": {"money", "summary-total-money"}, "text": "90.00", "colspan": 10})
        self.assertEqual(sum(cell["colspan"] for cell in monthly[:2]), 13)
        self.assertGreater(monthly[1]["colspan"], monthly[0]["colspan"])
        details = [cell for cell in monthly if cell["classes"] == {"meta-summary"}]
        self.assertEqual(
            [cell["text"] for cell in details],
            ["单位支持：45.00实际待缴纳：45.00", "单位支持：0.00实际待缴纳：45.00"],
        )
        self.assertTrue(all("summary-subtotal" not in classes for classes in footer.body_classes))

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
        pages = PdfReader(io.BytesIO(pdf)).pages
        self.assertEqual(len(pages), 1)
        self.assertRegex(pages[0].extract_text(), r"第\s*1\s*\S+\s*共\s*1\s*\S+")
        self.assertEqual(billing_statement_filename(statement), "张教授课题组实验动物饲养费核算汇总表 2026年06月.pdf")
        bundle = build_pdf_zip([("张教授.pdf", pdf), ("张教授.pdf", pdf)])
        with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
            self.assertEqual(archive.namelist(), ["张教授.pdf", "张教授 (2).pdf"])
            self.assertTrue(archive.read("张教授.pdf").startswith(b"%PDF"))

    def test_settlement_physical_pages_match_logical_pages_without_blank_trailer(self):
        statement = {
            "id": "physical-pages",
            "month": "2026-08",
            "pi": "分页测试",
            "sourceType": "pi_merged_quantity_sheet",
            "billingUnit": "cage_day",
            "iacucs": [f"Z{i}" for i in range(1, 7)],
        }
        lines = []
        for day in range(1, 32):
            breakdown = [
                {
                    "iacuc": f"Z{index}",
                    "species": "mouse",
                    "cageCount": index,
                    "billingItem": "小鼠饲养费",
                    "billingUnit": "cage_day",
                    "unitPrice": 4.5,
                    "payableAmount": index * 4.5,
                }
                for index in range(1, 7)
            ]
            lines.append(
                {
                    "date": f"2026-08-{day:02d}",
                    "cageCount": sum(range(1, 7)),
                    "amount": sum(item["payableAmount"] for item in breakdown),
                    "quantitySheetRowIds": [f"row-{day}"],
                    "iacucBreakdown": breakdown,
                }
            )

        pages = PdfReader(io.BytesIO(render_billing_statement_pdf(statement, lines))).pages
        self.assertEqual(len(pages), 2)
        first_text = pages[0].extract_text()
        second_text = pages[1].extract_text()
        self.assertRegex(first_text, r"第\s*1\s*\S+\s*共\s*2\s*\S+")
        self.assertRegex(second_text, r"第\s*2\s*\S+\s*共\s*2\s*\S+")
        self.assertGreater(len(first_text), 500)
        self.assertGreater(len(second_text), 500)

    def test_first_page_mouse_summary_includes_mouse_iacucs_from_later_pages(self):
        statement = {
            "id": "cross-page-mouse-summary",
            "month": "2026-08",
            "pi": "跨页汇总测试",
            "sourceType": "pi_merged_quantity_sheet",
            "billingUnit": "cage_day",
            "iacucs": [f"Z{i}" for i in range(1, 7)],
        }
        breakdown = [
            {
                "iacuc": f"Z{index}",
                "species": "mouse",
                "cageCount": index,
                "freeCages": index,
                "tier2BillableCages": index,
                "billingItem": "小鼠饲养费",
                "billingUnit": "cage_day",
                "unitPrice": 4.5,
                "overageUnitPrice": 6.5,
                "tiered": True,
                "payableAmount": index * 10,
            }
            for index in range(1, 7)
        ]
        html = billing_statement_html(
            statement,
            [
                {
                    "date": "2026-08-01",
                    "cageCount": 21,
                    "freeCages": 21,
                    "tier2BillableCages": 21,
                    "amount": 210,
                    "quantitySheetRowIds": ["row-1"],
                    "iacucBreakdown": breakdown,
                }
            ],
        )

        first_page = html.split("</main>", 1)[0]
        cross_page_summary = (
            '<td>2026-08-01</td><td colspan="3" class="num">21</td>'
            '<td colspan="2" class="num">21</td><td colspan="3" class="num">21</td>'
            '<td colspan="4" class="money">210.00</td>'
        )
        self.assertIn(cross_page_summary, first_page)
        self.assertEqual(first_page.count(cross_page_summary), 1)

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

    def test_same_iacuc_across_species_keeps_plain_headers_and_billing_details(self):
        statement = {
            "id": "same-iacuc-across-species",
            "month": "2026-11",
            "pi": "张教授",
            "sourceType": "pi_merged_quantity_sheet",
            "billingUnit": "mixed",
            "iacucs": ["ZS2026010"],
        }
        lines = [
            {
                "date": "2026-11-01",
                "cageCount": 6,
                "animalCount": 3,
                "amount": 42,
                "iacucBreakdown": [
                    {
                        "iacuc": "ZS2026010",
                        "species": "mouse",
                        "billingUnit": "cage_day",
                        "unitPrice": 4.5,
                        "cageCount": 6,
                        "payableAmount": 27,
                    },
                    {
                        "iacuc": "ZS2026010",
                        "species": "rabbit",
                        "billingUnit": "animal_day",
                        "unitPrice": 5,
                        "animalCount": 3,
                        "payableAmount": 15,
                    },
                ],
            }
        ]

        columns = statement_columns(statement, lines)
        self.assertEqual(
            [(column["species"], column["label"], column["unit"], column["unitPrice"]) for column in columns],
            [("小鼠", "ZS2026010", "cage_day", 4.5), ("兔", "ZS2026010", "animal_day", 5)],
        )
        html = billing_statement_html(statement, lines)
        headers = html.split("<thead>", 1)[1].split("</thead>", 1)[0]
        self.assertEqual(headers.count('<th colspan="12">ZS2026010</th>'), 2)
        self.assertNotIn("/ ¥", headers)
        self.assertIn('colspan="24">小鼠', headers)
        self.assertIn('colspan="12">兔', headers)
        self.assertIn("1）小鼠 4.5元/笼/日、2）兔 5元/只/日", html)

        footer = SettlementFooterParser()
        footer.feed(html)
        iacuc_cells = [
            cell
            for cell in footer.rows[0][1:]
            if "summary-subtotal" not in cell["classes"] and "group-empty-cell" not in cell["classes"]
        ]
        self.assertEqual([cell["text"] for cell in iacuc_cells], ["6", "27.00", "3", "15.00"])
        self.assertEqual(footer.rows[1][1]["text"], "42.00")

    def test_same_species_iacuc_keeps_rate_suffixes_for_distinct_billing_columns(self):
        statement = {
            "id": "same-species-iacuc-rates",
            "month": "2026-11",
            "pi": "张教授",
            "sourceType": "pi_merged_quantity_sheet",
            "billingUnit": "cage_day",
            "iacucs": ["ZS2026010"],
        }
        lines = [
            {
                "date": "2026-11-01",
                "cageCount": 5,
                "amount": 24,
                "iacucBreakdown": [
                    {
                        "iacuc": "ZS2026010",
                        "species": "mouse",
                        "billingUnit": "cage_day",
                        "unitPrice": price,
                        "cageCount": count,
                        "payableAmount": amount,
                    }
                    for price, count, amount in [(4.5, 2, 9), (5, 3, 15)]
                ],
            }
        ]

        columns = statement_columns(statement, lines)
        self.assertEqual([column["label"] for column in columns], ["ZS2026010 / ¥4.50", "ZS2026010 / ¥5.00"])
        html = billing_statement_html(statement, lines)
        headers = html.split("<thead>", 1)[1].split("</thead>", 1)[0]
        for label in ("ZS2026010 / ¥4.50", "ZS2026010 / ¥5.00"):
            self.assertIn(f'<th colspan="12">{label}</th>', headers)
        self.assertIn("小鼠 4.5元/笼/日；5元/笼/日", html)

        footer = SettlementFooterParser()
        footer.feed(html)
        iacuc_cells = [
            cell
            for cell in footer.rows[0][1:]
            if "summary-subtotal" not in cell["classes"] and "group-empty-cell" not in cell["classes"]
        ]
        self.assertEqual([cell["text"] for cell in iacuc_cells], ["2", "9.00", "3", "15.00"])
        self.assertEqual(footer.rows[1][1]["text"], "24.00")

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
        all_sheet = {
            **sheet,
            "customBillingSegments": [{**sheet["customBillingSegments"][0], "quantityMode": "all", "quantity": None}],
        }
        self.assertIn('<td class="num">全部</td>', quantity_sheet_html(all_sheet))
        statement_html = billing_statement_html(statement, lines)
        self.assertIn("自定义收费：", statement_html)
        self.assertIn("特殊饲料", statement_html)
        self.assertIn("每日5只兔，12元/只/日，本月共计60元", statement_html)
        self.assertNotIn("<h1>自定义收费明细</h1>", statement_html)
