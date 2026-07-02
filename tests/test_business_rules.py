import unittest

import server


class BusinessRuleParityTests(unittest.TestCase):
    def test_intake_batch_required_fields_and_print_quantities(self):
        item = {
            "id": "batch-1",
            "supplier": "购买单位",
            "iacuc": "Z2026001",
            "pi": "项目负责人",
            "owner": "实验负责人",
            "roomName": "8101",
            "intakeDate": "2026-07-01",
            "status": "pending_print",
        }
        server.validate_entity_payload("intakeBatches", item)
        with self.assertRaisesRegex(ValueError, "实验负责人不能为空"):
            server.validate_entity_payload("intakeBatches", {**item, "owner": ""})
        self.assertEqual(
            server.intake_card_suggested_quantity({"quantity": 23, "suggestedAnimalsPerCage": 5}, 4, 5),
            "",
        )

    def test_cage_card_short_code_round_trip(self):
        values = [server.encode_cage_card_sequence(index) for index in range(1, 101)]
        self.assertEqual(len(values), len(set(values)))
        self.assertTrue(all(server.is_cage_card_qr_id(value) for value in values))
        self.assertEqual([server.decode_cage_card_sequence(value) for value in values], list(range(1, 101)))

    def test_tiered_mouse_charge_and_allowances(self):
        self.assertEqual(server.free_cages_for_principal_type("pi"), 20)
        self.assertEqual(server.free_cages_for_principal_type("independent"), 10)
        self.assertEqual(server.tiered_daily_charge(12, 10)["amount"], 9.0)
        self.assertEqual(server.tiered_daily_charge(170, 10)["amount"], 740.0)

    def test_preferred_and_expired_free_cage_allocation(self):
        breakdown = [
            {
                "iacuc": "Z1",
                "cageCount": 8,
                "billingUnit": "cage_day",
                "freeAllowance": True,
                "freeEligible": True,
                "preferredFreeCages": 6,
                "freeCagePriority": 1,
            },
            {
                "iacuc": "Z2",
                "cageCount": 8,
                "billingUnit": "cage_day",
                "freeAllowance": True,
                "freeEligible": True,
                "preferredFreeCages": 0,
                "freeCagePriority": None,
            },
        ]
        self.assertEqual(server.allocate_daily_free_cages_by_iacuc(breakdown, 10), {"Z1": 8, "Z2": 2})
        breakdown[0]["freeEligible"] = False
        self.assertEqual(server.allocate_daily_free_cages_by_iacuc(breakdown, 10), {"Z2": 8})

    def test_animal_day_species_profiles(self):
        for item, price in (("guinea_pig", 3), ("rabbit", 5), ("monkey", 35), ("pig", 15), ("dog", 15)):
            profile = server.billing_profile_for_room({"defaultBillingItem": item, "defaultCustomerType": "internal"})
            self.assertEqual(profile["unit"], "animal_day")
            self.assertEqual(profile["unitPrice"], price)
            self.assertFalse(profile["freeAllowance"])

    def test_quantity_dates_and_rows_keep_month_semantics(self):
        self.assertEqual(server.normalize_sheet_date("6.3", "2026-06"), "2026-06-03")
        self.assertEqual(server.normalize_sheet_date("15", "2026-06"), "2026-06-15")
        with self.assertRaisesRegex(ValueError, "必须属于结算月份"):
            server.normalize_sheet_date("2026-07-01", "2026-06")
        row = server.normalize_quantity_sheet_row(
            {
                "id": "row-1",
                "date": "6.3",
                "addedCount": "4",
                "addedType": "转入",
                "transferInFromIacuc": " z2 ",
                "cageCount": "2",
                "transferMirrorContrib": {"source-a": "3"},
            },
            "2026-06",
        )
        self.assertEqual(row["date"], "2026-06-03")
        self.assertEqual(row["addedCount"], 4)
        self.assertEqual(row["transferInFromIacuc"], "z2")
        self.assertEqual(row["transferMirrorContrib"], {"source-a": 3})

    def test_quantity_sheet_lines_keep_transfer_and_daily_charge(self):
        sheets = [
            {
                "id": "source",
                "month": "2026-06",
                "iacuc": "Z1",
                "roomId": "r1",
                "initialCageCount": 4,
                "initialAnimalCount": 0,
                "rows": [
                    {
                        "id": "out",
                        "date": "2026-06-02",
                        "addedCount": 0,
                        "removedCount": 2,
                        "transferOutToIacuc": "Z2",
                    }
                ],
            },
            {
                "id": "target",
                "month": "2026-06",
                "iacuc": "Z2",
                "roomId": "r1",
                "initialCageCount": 0,
                "initialAnimalCount": 0,
                "rows": [],
            },
        ]
        rooms = [
            {
                "id": "r1",
                "defaultBillingItem": "mouse_standard",
                "defaultCustomerType": "internal",
                "billingProfileConfigured": True,
                "billingProfileConfirmed": True,
            }
        ]
        lines = server.quantity_sheet_statement_lines(sheets, 0, rooms, {})
        self.assertEqual(lines[0]["cageCount"], 4)
        self.assertEqual(lines[1]["cageCount"], 4)
        self.assertEqual(lines[1]["amount"], 18)
        self.assertEqual(lines[-1]["cumulative"], 30 * 18)

    def test_quantity_sheet_custom_unit_price_overrides_room_rate(self):
        sheets = [
            {
                "id": "custom-rate",
                "month": "2026-06",
                "iacuc": "Z1",
                "roomId": "r1",
                "customBillingEnabled": True,
                "customUnitPrice": 3.5,
                "initialCageCount": 4,
                "initialAnimalCount": 0,
                "rows": [],
            }
        ]
        rooms = [
            {
                "id": "r1",
                "defaultBillingItem": "mouse_standard",
                "defaultCustomerType": "internal",
                "billingProfileConfigured": True,
                "billingProfileConfirmed": True,
            }
        ]
        lines = server.quantity_sheet_statement_lines(sheets, 0, rooms, {})
        self.assertEqual(lines[0]["unitPrice"], 3.5)
        self.assertEqual(lines[0]["amount"], 14)
        self.assertEqual(lines[0]["iacucBreakdown"][0]["unitPrice"], 3.5)

    def test_workflow_scope_and_document_number_are_stable(self):
        statement = {
            "sourceType": "pi_merged_quantity_sheet",
            "pi": "张教授",
            "iacuc": "pi::张教授",
            "month": "2026-06",
        }
        self.assertEqual(server.workflow_scope_for_statement(statement), ("pi", "pi::张教授"))
        self.assertEqual(
            server.billing_workflow_business_key("pi", "pi::张教授", "2026-06", "pi_merged_quantity_sheet"),
            "pi|pi::张教授|2026-06|pi_merged_quantity_sheet",
        )
        self.assertEqual(server.make_statement_document_number(statement, 2), "CL-PQS-202606-PI-V02")


if __name__ == "__main__":
    unittest.main()
