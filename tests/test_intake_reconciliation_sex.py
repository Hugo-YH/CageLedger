"""Unconfirmed mixed defaults cannot override explicit text or per-batch image sex."""

import copy
from unittest import TestCase

from server_app.domains.intake.recognition_image_authority import incoming_image_fields
from server_app.domains.intake.recognition_matching import comparisons
from server_app.domains.intake.recognition_sex import FEMALE, MALE, MIXED, confirmed_sex, placeholder, stated_sex
from tests import test_intake_reconciliation as fixture
from tests.test_intake_recognition_images import image_input


class SexEvidenceTests(TestCase):
    def test_mixed_defaults_are_missing_without_erasing_the_values_shown_for_review(self):
        for before, incoming, expected, old_placeholder, new_placeholder in (
            (MIXED, FEMALE, "supplement", True, False),
            (MALE, MIXED, "missing", False, True),
            (MIXED, MIXED, "missing", True, True),
        ):
            with self.subTest(before=before, incoming=incoming):
                row = next(row for row in comparisons({"sex": before}, {"sex": incoming}) if row["field"] == "sex")
                self.assertEqual((row["before"], row["incoming"], row["status"]), (before, incoming, expected))
                self.assertEqual(row["placeholder"], {"before": old_placeholder, "incoming": new_placeholder})

    def test_real_mixed_sex_requires_evidence_and_includes_saved_recognition_rounds(self):
        for evidence in (
            {"rawMessage": "性别：雌性/雄性"},
            {"recognition": {"fieldSources": {"sex": "图片中明确为雌雄混合"}}},
            {"recognition": {"sources": [{"maleQuantity": 5, "femaleQuantity": 7}]}},
            {"recognition": {"recognitionRounds": [{"rawMessage": "性别：雄性+雌性", "evidence": {}}]}},
            {
                "recognition": {
                    "recognitionRounds": [{"evidence": {"sources": [{"maleQuantity": 5, "femaleQuantity": 7}]}}]
                }
            },
        ):
            with self.subTest(evidence=evidence):
                item = {"sex": MIXED, **evidence}
                self.assertEqual(confirmed_sex(item), MIXED)
                self.assertFalse(placeholder(item))
                row = next(row for row in comparisons(item, {"sex": MALE}) if row["field"] == "sex")
                self.assertEqual(row["status"], "different")
        self.assertTrue(
            placeholder({"sex": MIXED, "recognition": {"fieldSources": {"sex": "未确认，使用默认雌性/雄性"}}})
        )

    def test_symbol_counts_are_not_mistaken_for_a_mixed_option(self):
        self.assertEqual(stated_sex("♂数量:20 ♀数量:0"), MALE)
        self.assertEqual(stated_sex("雄性数量：0，雌性数量：20"), FEMALE)
        self.assertEqual(stated_sex("♂数量:5 ♀数量:7"), MIXED)
        self.assertIsNone(stated_sex("供应公司，性别未确认"))


class IntakeSexReconciliationTests(TestCase):
    setUp = fixture.IntakeReconciliationTests.setUp
    connect = fixture.IntakeReconciliationTests.connect
    save = fixture.IntakeReconciliationTests.save
    snapshot = fixture.IntakeReconciliationTests.snapshot
    original = fixture.IntakeReconciliationTests.original
    incoming_item = fixture.IntakeReconciliationTests.incoming_item
    preview = fixture.IntakeReconciliationTests.preview
    supplement = fixture.IntakeReconciliationTests.supplement

    def image_round(self, original, sex, *, male, female):
        images = [image_input("blue")]
        incoming = self.incoming_item(original, images, rawMessage="", sex=sex)
        incoming["recognition"]["sources"] = [
            {
                "imageIndex": 1,
                "kind": "husbandry",
                "iacuc": original["iacuc"],
                "batchNo": original["batchNo"],
                "quantity": original["quantity"],
                "strainRaw": original["strainRaw"],
                "specification": original["specification"],
                "sex": "雄性+雌性",
                "maleQuantity": male,
                "femaleQuantity": female,
            }
        ]
        return incoming, images

    def test_actual_female_image_completes_a_saved_default_and_preserves_card_identity(self):
        original = self.original(sex=MIXED, quantity=12, finalCardCount=3)
        incoming, images = self.image_round(original, FEMALE, male=0, female=12)
        before = self.snapshot()
        result = self.preview(incoming, images)
        self.assertEqual(result["sourceIssues"], [])
        candidate = result["items"][0]
        row = next(row for row in candidate["comparisons"] if row["field"] == "sex")
        self.assertEqual(row["status"], "supplement")
        self.assertTrue(row["placeholder"]["before"])
        self.assertEqual(candidate["mergedItem"]["sex"], FEMALE)
        self.assertEqual(self.snapshot(), before)
        saved = self.supplement(candidate, incoming, images)
        self.assertEqual(saved["sex"], FEMALE)
        for field in ("id", "cards", "quantity", "status", "intakeDate", "endDate"):
            self.assertEqual(saved.get(field), original.get(field), field)

    def test_later_default_is_missing_and_never_replaces_saved_real_sex(self):
        original = self.original(image=True, sex=MALE)
        incoming = self.incoming_item(original, rawMessage="补充预约", sex=MIXED)
        candidate = self.preview(incoming)["items"][0]
        row = next(row for row in candidate["comparisons"] if row["field"] == "sex")
        self.assertEqual(row["status"], "missing")
        self.assertEqual(candidate["mergedItem"]["sex"], MALE)
        saved = self.supplement(candidate, incoming)
        self.assertEqual(saved["sex"], MALE)

    def test_generic_sex_options_do_not_conflict_with_actual_single_sex_counts(self):
        original = self.original(sex=FEMALE, quantity=20)
        incoming, images = self.image_round(original, MALE, male=20, female=0)
        result = self.preview(incoming, images)
        self.assertEqual(result["sourceIssues"], [])
        self.assertIn("sex", incoming_image_fields(original, incoming, images))
        candidate = result["items"][0]
        self.assertTrue(candidate["canMerge"])
        self.assertEqual(candidate["mergedItem"]["sex"], MALE)

    def test_top_level_real_sex_must_agree_with_the_actual_image_counts(self):
        original = self.original(sex=MIXED, quantity=12)
        incoming, images = self.image_round(original, FEMALE, male=12, female=0)
        before = self.snapshot()
        result = self.preview(incoming, images)
        self.assertTrue(any(issue["field"] == "sex" for issue in result["sourceIssues"]))
        self.assertFalse(result["items"][0]["canMerge"])
        self.assertNotIn("sex", incoming_image_fields(original, incoming, images))
        self.assertEqual(self.snapshot(), before)

    def test_two_same_kind_images_with_opposite_actual_sex_counts_are_blocked(self):
        original = self.original(sex=MIXED, quantity=12)
        incoming, first = self.image_round(original, MIXED, male=12, female=0)
        images = [*first, image_input("green")]
        base_source = incoming["recognition"]["sources"][0]
        incoming = self.incoming_item(original, images, rawMessage="", sex=MIXED)
        incoming["recognition"]["sources"] = [
            base_source,
            {**copy.deepcopy(base_source), "imageIndex": 2, "maleQuantity": 0, "femaleQuantity": 12},
        ]
        before = self.snapshot()
        result = self.preview(incoming, images)
        self.assertTrue(any(issue["field"] == "sex" for issue in result["sourceIssues"]))
        self.assertFalse(result["items"][0]["canMerge"])
        self.assertEqual(self.snapshot(), before)

    def test_saved_mixed_image_round_remains_evidence_when_later_text_is_different(self):
        original = self.original(sex=MIXED, quantity=12)
        incoming, images = self.image_round(original, MIXED, male=5, female=7)
        candidate = self.preview(incoming, images)["items"][0]
        saved = self.supplement(candidate, incoming, images)
        self.assertEqual(confirmed_sex(saved), MIXED)
        self.assertFalse(placeholder(saved))
        later = self.incoming_item(saved, rawMessage="性别：雄性", sex=MALE)
        candidate = self.preview(later)["items"][0]
        row = next(row for row in candidate["comparisons"] if row["field"] == "sex")
        self.assertEqual(row["status"], "different")
        self.assertEqual(candidate["mergedItem"]["sex"], MIXED)

    def test_legacy_mixed_value_with_pure_image_evidence_is_not_an_empty_field(self):
        original = self.original(image=True, sex=MIXED, recognition={"fieldSources": {"sex": "♂数量:20 ♀数量:0"}})
        self.assertFalse(placeholder(original))
        incoming = self.incoming_item(original, rawMessage="性别：雌性", sex=FEMALE)
        candidate = self.preview(incoming)["items"][0]
        row = next(row for row in candidate["comparisons"] if row["field"] == "sex")
        self.assertEqual((row["before"], row["status"]), (MIXED, "unknown"))
        self.assertEqual(candidate["mergedItem"]["sex"], MIXED)
        self.assertTrue(all(change["field"] != "sex" for change in candidate["changes"]))
