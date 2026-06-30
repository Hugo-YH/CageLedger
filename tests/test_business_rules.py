import unittest

import server


class BusinessRuleParityTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
