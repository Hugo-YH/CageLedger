import json
import sqlite3
import unittest

import server
from server_app.persistence.backfills import backfill_quantity_sheet_staff


class BusinessRuleParityTests(unittest.TestCase):
    def test_quantity_sheet_staff_backfill_uses_audit_and_room_configuration(self):
        with sqlite3.connect(":memory:") as conn:
            conn.row_factory = sqlite3.Row
            conn.executescript(
                """
                CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT, payload TEXT NOT NULL);
                CREATE TABLE quantity_sheets (
                    id TEXT PRIMARY KEY, room_id TEXT, room_name TEXT, manager TEXT, payload TEXT NOT NULL
                );
                CREATE TABLE audit_events (
                    entity_type TEXT, entity_id TEXT, actor_display_name TEXT, at TEXT
                );
                """
            )
            conn.execute(
                "INSERT INTO rooms (id, name, payload) VALUES (?, ?, ?)",
                ("room-1", "8101", json.dumps({"id": "room-1", "name": "8101", "roomManager": "邹志成"})),
            )
            conn.execute(
                "INSERT INTO quantity_sheets (id, room_id, room_name, manager, payload) VALUES (?, ?, ?, ?, ?)",
                ("sheet-1", "room-1", "8101", "", json.dumps({"id": "sheet-1", "roomId": "room-1"})),
            )
            conn.execute(
                "INSERT INTO audit_events (entity_type, entity_id, actor_display_name, at) VALUES (?, ?, ?, ?)",
                ("quantity_sheet", "sheet-1", "李志权", "2026-06-01T10:00:00Z"),
            )
            self.assertEqual(backfill_quantity_sheet_staff(conn), 1)
            row = conn.execute("SELECT manager, payload FROM quantity_sheets WHERE id = 'sheet-1'").fetchone()
            payload = json.loads(row["payload"])
            self.assertEqual(row["manager"], "李志权")
            self.assertEqual(payload["manager"], "李志权")
            self.assertEqual(payload["roomManager"], "邹志成")
            self.assertEqual(backfill_quantity_sheet_staff(conn), 0)

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

    def test_tiered_allocation_concentrates_tier_on_largest_iacuc_and_priority_target(self):
        automatic = [
            {
                "iacuc": "A",
                "cageCount": 101,
                "billingUnit": "cage_day",
                "billingItem": "mouse_standard",
                "customerType": "internal",
                "unitPrice": 4.5,
                "overageUnitPrice": 6.5,
                "tiered": True,
                "freeCages": 0,
            },
            {
                "iacuc": "B",
                "cageCount": 100,
                "billingUnit": "cage_day",
                "billingItem": "mouse_standard",
                "customerType": "internal",
                "unitPrice": 4.5,
                "overageUnitPrice": 6.5,
                "tiered": True,
                "freeCages": 0,
            },
            {
                "iacuc": "C",
                "cageCount": 40,
                "billingUnit": "cage_day",
                "billingItem": "mouse_standard",
                "customerType": "internal",
                "unitPrice": 4.5,
                "overageUnitPrice": 6.5,
                "tiered": True,
                "freeCages": 0,
            },
        ]
        server.apply_tiered_breakdown_charges(automatic)
        automatic_by_iacuc = {item["iacuc"]: item for item in automatic}
        self.assertEqual(automatic_by_iacuc["C"]["tier2BillableCages"], 0)
        self.assertEqual(automatic_by_iacuc["B"]["tier2BillableCages"], 0)
        self.assertEqual(automatic_by_iacuc["A"]["tier2BillableCages"], 81)

        preferred = [dict(item) for item in automatic]
        preferred[1]["tierCagePriority"] = 1
        server.apply_tiered_breakdown_charges(preferred)
        preferred_by_iacuc = {item["iacuc"]: item for item in preferred}
        self.assertEqual(preferred_by_iacuc["B"]["tier2BillableCages"], 81)
        self.assertEqual(preferred_by_iacuc["C"]["tier2BillableCages"], 0)
        self.assertEqual(preferred_by_iacuc["A"]["tier2BillableCages"], 0)

    def test_full_exemption_does_not_consume_pi_allowance(self):
        breakdown = [
            {
                "iacuc": "Z1",
                "cageCount": 8,
                "billingUnit": "cage_day",
                "freeAllowance": True,
                "freeEligible": True,
                "fullExemption": True,
            },
            {
                "iacuc": "Z2",
                "cageCount": 8,
                "billingUnit": "cage_day",
                "freeAllowance": True,
                "freeEligible": True,
            },
        ]
        self.assertEqual(server.allocate_daily_free_cages_by_iacuc(breakdown, 10), {"Z1": 8, "Z2": 8})
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

    def test_quantity_sheet_priority_tier_marks_target_iacuc(self):
        sheets = [
            {
                "id": "a",
                "month": "2026-06",
                "iacuc": "A",
                "pi": "张教授",
                "roomId": "r1",
                "initialCageCount": 101,
                "initialAnimalCount": 0,
                "rows": [],
            },
            {
                "id": "b",
                "month": "2026-06",
                "iacuc": "B",
                "pi": "张教授",
                "roomId": "r1",
                "tierCagePriority": 1,
                "initialCageCount": 100,
                "initialAnimalCount": 0,
                "rows": [],
            },
            {
                "id": "c",
                "month": "2026-06",
                "iacuc": "C",
                "pi": "张教授",
                "roomId": "r1",
                "initialCageCount": 40,
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
        first_day = {item["iacuc"]: item for item in lines[0]["iacucBreakdown"]}
        self.assertEqual(first_day["B"]["tier2BillableCages"], 81)
        self.assertEqual(first_day["C"]["tier2BillableCages"], 0)

    def test_quantity_sheet_full_exemption_zeroes_only_the_target_iacuc(self):
        sheets = [
            {
                "id": "exempt",
                "month": "2026-06",
                "iacuc": "Z1",
                "roomId": "r1",
                "fullExemption": True,
                "initialCageCount": 4,
                "initialAnimalCount": 0,
                "rows": [],
            },
            {
                "id": "regular",
                "month": "2026-06",
                "iacuc": "Z2",
                "roomId": "r1",
                "initialCageCount": 3,
                "initialAnimalCount": 0,
                "rows": [],
            },
            {
                "id": "exempt-second-room",
                "month": "2026-06",
                "iacuc": "Z1",
                "roomId": "r1",
                "initialCageCount": 2,
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
        self.assertEqual(lines[0]["freeCages"], 6)
        self.assertEqual(lines[0]["billableCages"], 3)
        self.assertEqual(lines[0]["amount"], 13.5)
        self.assertTrue(lines[0]["iacucBreakdown"][0]["fullExemption"])

    def test_quantity_sheet_full_exemption_supports_animal_day_billing(self):
        sheets = [
            {
                "id": "rabbit-exempt",
                "month": "2026-06",
                "iacuc": "Z-RABBIT",
                "roomId": "rabbit-room",
                "fullExemption": True,
                "initialCageCount": 1,
                "initialAnimalCount": 5,
                "rows": [],
            }
        ]
        rooms = [
            {
                "id": "rabbit-room",
                "defaultBillingItem": "rabbit",
                "defaultCustomerType": "internal",
                "billingProfileConfigured": True,
                "billingProfileConfirmed": True,
            }
        ]
        lines = server.quantity_sheet_statement_lines(sheets, 0, rooms, {})
        self.assertEqual(lines[0]["freeCages"], 5)
        self.assertEqual(lines[0]["billableAnimals"], 0)
        self.assertEqual(lines[0]["amount"], 0)
        summary = server.summarize_statement(
            {"billingUnit": "animal_day", "iacucs": ["Z-RABBIT"], "freeCageAllowance": 0},
            lines,
            {"Z-RABBIT": {}},
            160,
        )
        self.assertEqual(summary["supportAmount"], 750)
        self.assertEqual(summary["payableAmount"], 0)

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
