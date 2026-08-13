import unittest

from server_app.domains.billing.statements import distinct_funding_text
from server_app.pdf.documents import billing_statement_html


class FundingDeduplicationTests(unittest.TestCase):
    def test_keeps_first_funding_name_for_same_fund_code(self):
        values = [
            "国家自然科学基金面上项目（经费本编号：30309010012334）",
            "国自然面上项目 （30309010012334 ）",
            "广东省重大致盲眼病基础研究卓越团队项目（30309010056789）",
        ]
        self.assertEqual(
            distinct_funding_text(values),
            "国家自然科学基金面上项目（经费本编号：30309010012334）、广东省重大致盲眼病基础研究卓越团队项目（30309010056789）",
        )

    def test_preserves_distinct_unidentified_funding_text(self):
        self.assertEqual(distinct_funding_text(["院内配套", "院内配套", "专项支持"]), "院内配套、专项支持")

    def test_requires_every_number_group_to_match(self):
        values = [
            "基金（2026-01，30309010012334）",
            "基金别名（2026-02，30309010012334）",
            "基金简称（2026-01，30309010012334）",
        ]
        self.assertEqual(
            distinct_funding_text(values),
            "基金（2026-01，30309010012334）、基金别名（2026-02，30309010012334）",
        )

    def test_statement_preview_uses_deduplicated_funding(self):
        funding = distinct_funding_text(
            ["国家自然科学基金面上项目（经费本编号：30309010012334）", "国自然面上项目（30309010012334）"]
        )
        html = billing_statement_html(
            {
                "iacuc": "Z2024115",
                "month": "2026-07",
                "pi": "张教授",
                "funding": funding,
                "sourceType": "pi_merged_quantity_sheet",
            },
            [],
        )
        self.assertIn("国家自然科学基金面上项目", html)
        self.assertNotIn("国自然面上项目", html)
