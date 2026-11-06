import copy
import unittest
from unittest.mock import patch

from server_app.domains.intake import rules
from server_app.domains.state.entity_mutations import ensure_intake_batch_card_qr_ids


class CageCardAllocatorTests(unittest.TestCase):
    def test_mixed_retained_collision_and_legacy_codes_preserve_card_identity(self):
        code = rules.encode_cage_card_sequence
        reserved = {code(1), code(3)}
        batch = {
            "id": "mixed",
            "finalCardCount": 5,
            "quantity": 25,
            "suggestedAnimalsPerCage": 5,
            "cards": [
                {"id": "old-a", "qrId": code(8)},
                {"id": "old-b", "qrId": code(3)},
                {"id": "old-c", "qrId": code(20)},
                {"id": "legacy", "qrId": "LEGACY01"},
            ],
        }
        before = copy.deepcopy(batch)
        result = ensure_intake_batch_card_qr_ids({}, batch, used_qr_ids=reserved)
        self.assertEqual([card["qrId"] for card in result["cards"]], [code(8), code(9), code(20), "LEGACY01", code(21)])
        self.assertEqual(
            [card["id"] for card in result["cards"]], ["old-a", "old-b", "old-c", "legacy", "mixed-card-5"]
        )
        self.assertEqual(result["cards"][0]["suggestedQuantity"], "5")
        self.assertEqual(reserved, {code(1), code(3)})
        self.assertEqual(batch, before)

    def test_sequence_rollover_skips_occupied_codes(self):
        code = rules.encode_cage_card_sequence
        result = ensure_intake_batch_card_qr_ids(
            {}, {"id": "wrap", "finalCardCount": 3}, used_qr_ids={code(rules.CAGE_CARD_QR_CAPACITY), code(1)}
        )
        self.assertEqual([card["qrId"] for card in result["cards"]], [code(2), code(3), code(4)])

    def test_standalone_helper_does_not_reserve_and_reports_exhaustion(self):
        code = rules.encode_cage_card_sequence
        reserved = {code(1)}
        self.assertEqual(rules.next_cage_card_qr_id(reserved), code(2))
        self.assertEqual(reserved, {code(1)})
        with (
            patch.object(rules, "CAGE_CARD_QR_CAPACITY", 3),
            patch.object(rules, "encode_cage_card_sequence", side_effect=lambda n: ("A", "B", "C")[(n - 1) % 3]),
            patch.object(rules, "decode_cage_card_sequence", side_effect={"A": 1, "B": 2, "C": 3}.get),
            self.assertRaisesRegex(ValueError, "短码已用尽"),
        ):
            rules.next_cage_card_qr_id({"A", "B", "C"})

    def test_bulk_allocation_work_is_linear_and_retained_cards_need_no_sequence_scan(self):
        code = rules.encode_cage_card_sequence
        reserved = {code(index) for index in range(1, 1001)}
        with patch.object(rules, "decode_cage_card_sequence", wraps=rules.decode_cage_card_sequence) as decode:
            result = ensure_intake_batch_card_qr_ids({}, {"id": "bulk", "finalCardCount": 20}, used_qr_ids=reserved)
            self.assertLessEqual(decode.call_count, 1040)
        self.assertEqual([card["qrId"] for card in result["cards"]], [code(index) for index in range(1001, 1021)])
        with patch.object(rules, "decode_cage_card_sequence", side_effect=AssertionError("unneeded global scan")):
            retained = ensure_intake_batch_card_qr_ids({}, result, used_qr_ids=reserved)
        self.assertEqual(retained, result)
