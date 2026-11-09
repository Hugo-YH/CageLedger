"""Actual-arrival supplementation preserves the period, preview, persistence and audit."""

import json
from unittest import TestCase

from server_app.repositories.audit_storage import read_payload
from tests import test_intake_reconciliation as fixture


class IntakePeriodReconciliationTests(TestCase):
    setUp = fixture.IntakeReconciliationTests.setUp
    connect = fixture.IntakeReconciliationTests.connect
    save = fixture.IntakeReconciliationTests.save
    snapshot = fixture.IntakeReconciliationTests.snapshot
    original = fixture.IntakeReconciliationTests.original
    incoming_item = fixture.IntakeReconciliationTests.incoming_item
    preview = fixture.IntakeReconciliationTests.preview
    supplement = fixture.IntakeReconciliationTests.supplement

    def test_late_arrival_keeps_61_days_and_extends_end_in_preview_transaction_and_audit(self):
        original = self.original(image=True, intakeDate="", endDate="2027-01-04", husbandryDays=61)
        incoming = self.incoming_item(original, intakeDate="2026-11-11", endDate="", husbandryDays=None)
        before = self.snapshot()
        candidate = self.preview(incoming)["items"][0]
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(
            (candidate["mergedItem"]["endDate"], candidate["mergedItem"]["husbandryDays"]), ("2027-01-11", 61)
        )
        rows = {row["field"]: row for row in candidate["comparisons"]}
        calculation = {
            "basis": "fixed_days",
            "periodSource": "saved",
            "startDate": "2026-11-11",
            "endDate": "2027-01-11",
            "days": 61,
        }
        self.assertEqual(rows["endDate"]["status"], "calculated")
        self.assertEqual(rows["husbandryDays"]["status"], "retained")
        self.assertEqual(rows["endDate"]["calculation"], calculation)
        saved = self.supplement(candidate, incoming)
        self.assertEqual((saved["endDate"], saved["husbandryDays"]), ("2027-01-11", 61))
        self.assertEqual(
            (saved["id"], saved["cards"], saved["status"]), (original["id"], original["cards"], original["status"])
        )
        self.assertEqual(saved["recognition"]["imageIds"], original["recognition"]["imageIds"])
        self.assertIn("endDate", saved["recognition"]["recognitionRounds"][0]["appliedFields"])
        with self.connect() as conn:
            event_id = conn.execute(
                "SELECT id FROM audit_events WHERE action='intake_batch.recognition_merged'"
            ).fetchone()[0]
            changes = json.loads(read_payload(conn, event_id))["after"]["changes"]
        change = next(row for row in changes if row["field"] == "endDate")
        self.assertEqual((change["before"], change["after"], change["source"]), ("2027-01-04", "2027-01-11", "text"))
        self.assertEqual(change["calculation"], calculation)

    def test_calendar_months_use_month_end_and_show_changed_day_count(self):
        original = self.original(intakeDate="", husbandryMonths=1, husbandryDays=31, endDate="2027-02-04")
        incoming = self.incoming_item(
            original, intakeDate="2027-01-31", husbandryMonths=None, husbandryDays=None, endDate=""
        )
        candidate = self.preview(incoming)["items"][0]
        rows = {row["field"]: row for row in candidate["comparisons"]}
        self.assertEqual(rows["husbandryDays"]["status"], "calculated")
        self.assertEqual(rows["husbandryDays"]["calculation"]["basis"], "calendar_months")
        self.assertEqual(rows["husbandryDays"]["calculation"]["months"], 1)
        saved = self.supplement(candidate, incoming)
        self.assertEqual((saved["husbandryMonths"], saved["husbandryDays"], saved["endDate"]), (1, 28, "2027-02-28"))

    def test_zero_days_and_end_only_periods_have_explicit_calculation_bases(self):
        for index, (days, end, expected, basis) in enumerate(
            ((0, "2027-01-04", "2026-11-11", "fixed_days"), (None, "2027-01-04", "2027-01-04", "date_range"))
        ):
            with self.subTest(days=days):
                original = self.original(
                    id=f"zero-{index}", batchNo=f"ZERO-{index}", intakeDate="", husbandryDays=days, endDate=end
                )
                incoming = self.incoming_item(original, intakeDate="2026-11-11", husbandryDays=None, endDate="")
                candidate = self.preview(incoming)["items"][0]
                self.assertEqual(candidate["mergedItem"]["endDate"], expected)
                row = next(row for row in candidate["comparisons"] if row["field"] == "husbandryDays")
                self.assertEqual(row["calculation"]["basis"], basis)
                saved = self.supplement(candidate, incoming)
                self.assertEqual(saved["husbandryDays"], 0 if days == 0 else 54)

    def test_invalid_or_overflowing_period_cannot_be_confirmed(self):
        for index, (start, days, end) in enumerate((("2027-02-01", None, "2027-01-04"), ("9999-12-31", 61, ""))):
            with self.subTest(start=start):
                original = self.original(
                    id=f"invalid-{index}", batchNo=f"INVALID-{index}", intakeDate="", husbandryDays=days, endDate=end
                )
                incoming = self.incoming_item(original, intakeDate=start)
                before = self.snapshot()
                candidate = self.preview(incoming)["items"][0]
                self.assertEqual(candidate["reviewStatus"], "conflict")
                self.assertFalse(candidate["canMerge"])
                self.assertEqual(self.snapshot(), before)
