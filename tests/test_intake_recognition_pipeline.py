"""Fresh facts flow once; saved evidence and legacy semantics remain intact."""

import copy
import unittest
from unittest.mock import patch

from server_app.domains.intake.ai_parse import _normalize_payload
from server_app.domains.intake.recognition_evidence import (
    normalize_image_result,
    sanitize_evidence,
    structure_image_sources,
)
from server_app.domains.intake.recognition_pipeline import normalize_image_recognition
from server_app.domains.intake.recognition_sources import sanitize_sources
from tests.test_intake_recognition_images import sample_result


def payload():
    result = sample_result()
    result["recognition"]["warnings"] = ["请核对运输条件，不可省略。"]
    result["imageSources"] = [
        {
            "kind": "husbandry",
            "imageIndex": 1,
            "batchNo": "(Z2026108)2026102609",
            "strainRaw": "C57",
            "specification": "8周龄",
            "quantity": 77,
        },
        {
            "kind": "purchase",
            "imageIndex": 2,
            "purchaseOrderNo": "ＤＣ２０２６１０２６４８０８６０１",
            "strainRaw": "ICR",
            "specification": "6周龄",
            "quantity": 27,
            "quantityFacts": {
                "lineQuantity": 27,
                "lineQuantityEvidence": "27只",
                "giftQuantity": 3,
                "giftEvidence": "额外赠送3只",
                "giftInclusion": "extra",
                "giftScope": "current_item",
            },
        },
    ]
    return result


class RecognitionPipelineTests(unittest.TestCase):
    def test_fresh_sources_are_normalized_once_and_model_input_is_not_mutated(self):
        raw = payload()
        before = copy.deepcopy(raw)
        # Models may repeat source facts under recognition.sources; only the
        # fresh fact stage processes the selected source list.
        raw["recognition"]["sources"] = copy.deepcopy(raw["imageSources"])
        before = copy.deepcopy(raw)
        with patch(
            "server_app.domains.intake.recognition_pipeline.sanitize_sources", wraps=sanitize_sources
        ) as sanitize:
            item, evidence = normalize_image_recognition(raw, "test", _normalize_payload)
        self.assertEqual(sanitize.call_count, 1)
        self.assertEqual(raw, before)
        self.assertEqual((item["purchaseOrderNo"], item["orderNo"]), ("C2026102648086", "DC202610264808601"))
        self.assertEqual(item["quantity"], 30)
        self.assertEqual(evidence["sources"][0]["quantity"], 77)
        self.assertEqual(evidence["sources"][1]["quantity"], 27)

    def test_structured_review_carries_rule_fields_and_all_extra_instructions(self):
        item, evidence = normalize_image_recognition(payload(), "test", _normalize_payload)
        review = evidence["review"]
        self.assertEqual(review["version"], 1)
        self.assertEqual([row["key"] for row in review["comparisons"]], ["strain", "specification", "quantity"])
        self.assertEqual(review["comparisons"][2]["purchase"], "27 只（赠送 3 只）；本次实际 30 只")
        self.assertIn("请核对运输条件，不可省略。", review["reminders"])
        self.assertIn("需求可能包含后续批次，请核对笼数及性别适用范围。", review["reminders"])
        self.assertTrue(any("接收日期" in warning for warning in review["reminders"]))
        self.assertEqual(sanitize_evidence(evidence)["review"], review)
        self.assertEqual(item["intakeDate"], "")

    def test_phase_result_matches_existing_evidence_finalizer_except_additive_review(self):
        raw = payload()
        merged = structure_image_sources(copy.deepcopy(raw))
        legacy_item, legacy_evidence = normalize_image_result(merged, _normalize_payload(merged), "test")
        item, evidence = normalize_image_recognition(raw, "test", _normalize_payload)
        self.assertEqual(item, legacy_item)
        evidence.pop("review")
        self.assertEqual(evidence, legacy_evidence)

    def test_historical_evidence_is_not_upgraded_or_reinterpreted_by_sanitization(self):
        source = {"kind": "purchase", "imageIndex": 1, "purchaseOrderNo": "ＤＣ２０２６１０２６４８０８６０１"}
        raw = {"extractedText": "原始文字", "fieldSources": {}, "warnings": ["旧提示"], "sources": [source]}
        result = sanitize_evidence(raw)
        self.assertNotIn("review", result)
        self.assertEqual(result["sources"][0]["purchaseOrderNo"], source["purchaseOrderNo"])
        self.assertNotIn("orderNo", result["sources"][0])
        self.assertEqual(raw["sources"][0], source)

    def test_unknown_review_versions_and_malformed_rows_do_not_replace_legacy_review(self):
        for version in (True, "1", 2, None):
            with self.subTest(version=version):
                self.assertNotIn(
                    "review", sanitize_evidence({"review": {"version": version, "comparisons": [], "reminders": []}})
                )
        evidence = sanitize_evidence(
            {
                "review": {
                    "version": 1,
                    "comparisons": [{"key": []}, {"key": "unknown"}, None],
                    "reminders": ["请核对", "请核对", 42],
                }
            }
        )
        self.assertEqual(evidence["review"], {"version": 1, "comparisons": [], "reminders": ["请核对"]})
