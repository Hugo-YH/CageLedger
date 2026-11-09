"""Field choices are previewed, token-bound and reapplied inside the real transaction."""

import json
from unittest import TestCase

from server_app.repositories.audit_storage import read_payload
from server_app.repositories.entities import upsert_intake_batch
from server_app.shared.concurrency import StaleWriteError
from tests import test_intake_reconciliation as fixture


class IntakeFieldResolutionTests(TestCase):
    setUp = fixture.IntakeReconciliationTests.setUp
    connect = fixture.IntakeReconciliationTests.connect
    save = fixture.IntakeReconciliationTests.save
    snapshot = fixture.IntakeReconciliationTests.snapshot
    original = fixture.IntakeReconciliationTests.original
    incoming_item = fixture.IntakeReconciliationTests.incoming_item
    preview = fixture.IntakeReconciliationTests.preview
    supplement = fixture.IntakeReconciliationTests.supplement

    def test_each_difference_needs_a_choice_then_the_preview_and_saved_values_match(self):
        original = self.original(sex="雄性")
        incoming = self.incoming_item(original, quantity=9, sex="雌性", rawMessage="新一轮预约内容")
        before = self.snapshot()
        candidate = self.preview(incoming)["items"][0]
        self.assertCountEqual(candidate["resolutionFields"], ["quantity", "sex"])
        self.assertFalse(candidate["canMerge"])
        self.assertEqual(candidate["resolutions"], {})
        partial = self.preview(incoming, resolutions={"quantity": "saved"})["items"][0]
        self.assertFalse(partial["canMerge"])
        choices = {"quantity": "saved", "sex": "incoming"}
        candidate = self.preview(incoming, resolutions=choices)["items"][0]
        self.assertTrue(candidate["canMerge"])
        self.assertEqual(candidate["resolutions"], choices)
        self.assertEqual(self.snapshot(), before)
        candidate["mergedItem"].update(quantity=999, status="received", cards=[])
        saved = self.supplement(candidate, incoming, resolutions=choices)
        self.assertEqual((saved["quantity"], saved["sex"]), (5, "雌性"))
        self.assertEqual(
            (saved["id"], saved["cards"], saved["status"]), (original["id"], original["cards"], original["status"])
        )
        with self.connect() as conn:
            event_id = conn.execute(
                "SELECT id FROM audit_events WHERE action='intake_batch.recognition_merged'"
            ).fetchone()[0]
            after = json.loads(read_payload(conn, event_id))["after"]
        self.assertEqual(after["resolutions"], choices)
        self.assertEqual(next(row["after"] for row in after["changes"] if row["field"] == "sex"), "雌性")

    def test_chosen_arrival_date_preserves_the_period_and_extends_end(self):
        original = self.original(intakeDate="2026-11-04", endDate="2027-01-04", husbandryDays=61)
        incoming = self.incoming_item(original, intakeDate="2026-11-11", endDate="", husbandryDays=None)
        choices = {"intakeDate": "incoming"}
        candidate = self.preview(incoming, resolutions=choices)["items"][0]
        self.assertTrue(candidate["canMerge"])
        saved = self.supplement(candidate, incoming, resolutions=choices)
        self.assertEqual(
            (saved["intakeDate"], saved["endDate"], saved["husbandryDays"]), ("2026-11-11", "2027-01-11", 61)
        )

    def test_chosen_end_date_is_respected_and_days_are_derived_from_it(self):
        original = self.original(intakeDate="2026-11-11", endDate="2026-12-05", husbandryDays=24)
        incoming = self.incoming_item(original, endDate="2026-12-12", husbandryDays=None)
        choices = {"endDate": "incoming"}
        candidate = self.preview(incoming, resolutions=choices)["items"][0]
        calculation = next(row["calculation"] for row in candidate["comparisons"] if row["field"] == "husbandryDays")
        self.assertEqual((calculation["basis"], calculation["periodSource"]), ("date_range", "incoming"))
        saved = self.supplement(candidate, incoming, resolutions=choices)
        self.assertEqual((saved["endDate"], saved["husbandryDays"]), ("2026-12-12", 31))

    def test_inconsistent_date_and_period_keep_the_controls_available_for_correction(self):
        original = self.original(intakeDate="2026-11-11", endDate="2027-01-11", husbandryDays=61)
        incoming = self.incoming_item(original, endDate="2026-11-15", husbandryDays=10, rawMessage="本轮补充")
        choices = {"endDate": "incoming", "husbandryDays": "incoming"}
        candidate = self.preview(incoming, resolutions=choices)["items"][0]
        self.assertFalse(candidate["canMerge"])
        self.assertIn("不一致", candidate["reason"])
        self.assertCountEqual(candidate["resolutionFields"], choices)
        corrected = {"endDate": "saved", "husbandryDays": "saved"}
        candidate = self.preview(incoming, resolutions=corrected)["items"][0]
        self.assertTrue(candidate["canMerge"])
        saved = self.supplement(candidate, incoming, resolutions=corrected)
        self.assertEqual((saved["endDate"], saved["husbandryDays"]), (original["endDate"], 61))

    def test_choices_are_part_of_the_confirmation_token(self):
        original = self.original(sex="雄性")
        incoming = self.incoming_item(original, sex="雌性", rawMessage="本轮补充")
        choices = {"sex": "incoming"}
        candidate = self.preview(incoming, resolutions=choices)["items"][0]
        before = self.snapshot()
        for changed in ({}, {"sex": "saved"}):
            with self.subTest(changed=changed), self.assertRaises(StaleWriteError):
                self.supplement(candidate, incoming, resolutions=changed)
            self.assertEqual(self.snapshot(), before)

    def test_image_precedence_is_a_default_that_an_explicit_choice_can_override(self):
        original = self.original(image=True, sex="雄性")
        incoming = self.incoming_item(original, sex="雌性", rawMessage="本轮补充")
        default = self.preview(incoming)["items"][0]
        self.assertEqual(default["resolutions"], {"sex": "saved"})
        self.assertEqual(default["mergedItem"]["sex"], "雄性")
        choices = {"sex": "incoming"}
        candidate = self.preview(incoming, resolutions=choices)["items"][0]
        saved = self.supplement(candidate, incoming, resolutions=choices)
        self.assertEqual(saved["sex"], "雌性")
        self.assertEqual(saved["recognition"]["images"], original["recognition"]["images"])

    def test_choices_cannot_bypass_identity_received_or_source_conflicts(self):
        original = self.original(sex="雄性")
        incoming = self.incoming_item(original, sex="雌性")
        for forbidden in ({"iacuc": "incoming"}, {"batchNo": "saved"}, {"quantity": "anything"}):
            with self.subTest(forbidden=forbidden), self.assertRaises(ValueError):
                self.preview(incoming, resolutions=forbidden)
        wrong_iacuc = self.preview({**incoming, "iacuc": "Z2026002"}, resolutions={"sex": "incoming"})["items"][0]
        self.assertFalse(wrong_iacuc["canMerge"])
        self.assertEqual(wrong_iacuc["resolutionFields"], [])
        conflict = self.incoming_item(
            original,
            sex="雌性",
            recognition={
                "sources": [
                    {"imageIndex": 1, "kind": "husbandry", "maleQuantity": 5, "femaleQuantity": 0},
                    {"imageIndex": 2, "kind": "husbandry", "maleQuantity": 0, "femaleQuantity": 5},
                ]
            },
        )
        result = self.preview(conflict, resolutions={"sex": "incoming"})
        self.assertTrue(result["sourceIssues"])
        self.assertFalse(result["items"][0]["canMerge"])
        self.assertEqual(result["items"][0]["resolutionFields"], [])
        for protection in ({"status": "received"}, {"receipts": [{"id": "partial", "cardCount": 1}]}):
            with self.subTest(protection=protection):
                with self.connect() as conn:
                    upsert_intake_batch(conn, {**original, **protection})
                candidate = self.preview(incoming, resolutions={"sex": "incoming"})["items"][0]
                self.assertFalse(candidate["canMerge"])
                self.assertEqual(candidate["resolutionFields"], [])
