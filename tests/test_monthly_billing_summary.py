import io
import unittest

import openpyxl

from server_app.domains.billing.monthly_summary import build_monthly_summary_rows, build_monthly_summary_xlsx


class MonthlyBillingSummaryTests(unittest.TestCase):
    def setUp(self):
        self.rooms = [
            {
                "id": "room-zj",
                "name": "8101",
                "facility": "zhujiang",
                "defaultSpecies": "mouse",
                "defaultBillingItem": "mouse_standard",
                "defaultCustomerType": "internal",
                "billingProfileConfigured": True,
                "billingProfileConfirmed": True,
            },
            {
                "id": "room-bwd",
                "name": "B201",
                "facility": "bioisland",
                "defaultSpecies": "mouse",
                "defaultBillingItem": "mouse_standard",
                "defaultCustomerType": "internal",
                "billingProfileConfigured": True,
                "billingProfileConfirmed": True,
            },
        ]
        self.applications = {
            "Z2026001": {
                "funding": "伦理经费-001",
                "projectStartDate": "2026-01-01",
                "projectEndDate": "2026-12-31",
            },
            "Z2026002": {
                "funding": "伦理经费-002",
                "projectStartDate": "2026-02-01",
                "projectEndDate": "2026-11-30",
            },
        }

    def test_splits_facilities_and_keeps_zero_amount_sheet(self):
        sheets = [
            sheet("sheet-zj", "Z2026001", "room-zj", "8101", 1),
            sheet("sheet-bwd", "Z2026001", "room-bwd", "B201", 1),
            sheet("sheet-zero", "Z2026002", "room-zj", "8101", 0),
        ]
        rows = build_monthly_summary_rows(
            "2026-06",
            sheets,
            self.rooms,
            self.applications,
            {"张教授": "independent"},
            {"张教授": {"fundBookNo": "本号-01", "reimbursementFormNo": "报销-01"}},
        )
        self.assertEqual(
            {(row["iacuc"], row["facility"]) for row in rows},
            {("Z2026001", "生物岛"), ("Z2026001", "珠江新城"), ("Z2026002", "珠江新城")},
        )
        self.assertTrue(all(row["amount"] == row["supportAmount"] + row["payableAmount"] for row in rows))
        rows_by_iacuc = {row["iacuc"]: row for row in rows if row["iacuc"] == "Z2026002"}
        self.assertEqual(next(row for row in rows if row["iacuc"] == "Z2026001")["funding"], "伦理经费-001")
        self.assertTrue(all(row["species"] == "小鼠" for row in rows))
        self.assertTrue(all(row["fundBookNo"] == "本号-01" for row in rows))
        self.assertEqual(rows_by_iacuc["Z2026002"]["amount"], 0)
        self.assertEqual(rows_by_iacuc["Z2026002"]["payableAmount"], 0)

    def test_workbook_matches_monthly_summary_columns_and_formula(self):
        rows = build_monthly_summary_rows(
            "2026-06",
            [sheet("sheet-zj", "Z2026001", "room-zj", "8101", 1)],
            self.rooms,
            self.applications,
            {"张教授": "independent"},
            {},
        )
        workbook = openpyxl.load_workbook(io.BytesIO(build_monthly_summary_xlsx("2026-06", rows)), data_only=False)
        worksheet = workbook.active
        self.assertEqual(worksheet["A1"].value, "2026年6月动物饲养费汇总")
        self.assertEqual(worksheet["D2"].value, "IACUC编号")
        self.assertEqual(worksheet["I3"].value, "=G3-H3")
        self.assertEqual(worksheet["G3"].number_format, "0.00")
        self.assertEqual(worksheet.freeze_panes, "A3")

    def test_invalid_sheet_error_identifies_pi_and_iacuc(self):
        invalid_sheet = sheet("invalid", "", "room-zj", "8101", 1)
        invalid_sheet["pi"] = ""
        with self.assertRaisesRegex(ValueError, r"项目负责人 未填写 / IACUC 未填写：缺少项目负责人"):
            build_monthly_summary_rows(
                "2026-06",
                [invalid_sheet],
                self.rooms,
                self.applications,
                {},
                {},
            )

    def test_expired_iacuc_before_month_marks_month_as_ineligible(self):
        applications = {
            **self.applications,
            "Z2026003": {"funding": "伦理经费-003", "projectEndDate": "2025-12-30"},
        }
        rows = build_monthly_summary_rows(
            "2026-06",
            [sheet("expired", "Z2026003", "room-zj", "8101", 1)],
            self.rooms,
            applications,
            {"张教授": "independent"},
            {},
        )
        self.assertEqual(rows[0]["notes"], "Z2026003 已于 2025-12-30 到期，本月不参与减免")

    def test_expired_iacuc_during_month_uses_next_day(self):
        applications = {
            **self.applications,
            "Z2026004": {"funding": "伦理经费-004", "projectEndDate": "2026-06-10"},
        }
        rows = build_monthly_summary_rows(
            "2026-06",
            [sheet("expired-in-month", "Z2026004", "room-zj", "8101", 1)],
            self.rooms,
            applications,
            {"张教授": "independent"},
            {},
        )
        self.assertEqual(rows[0]["notes"], "Z2026004 于 2026-06-10 到期，自 2026-06-11 起不参与减免")


def sheet(sheet_id, iacuc, room_id, room_name, cages):
    return {
        "id": sheet_id,
        "month": "2026-06",
        "iacuc": iacuc,
        "pi": "张教授",
        "roomId": room_id,
        "roomName": room_name,
        "initialCageCount": cages,
        "initialAnimalCount": 0,
        "rows": [],
    }


if __name__ == "__main__":
    unittest.main()
