"""Fresh image recognition: source facts, merged appointment, final review."""

from dataclasses import dataclass

from .recognition_evidence import (
    _check_image_identifiers,
    has_explicit_intake_date,
    normalize_image_result,
    sanitize_evidence,
)
from .recognition_review import RecognitionReview
from .recognition_sources import merge_sources, sanitize_sources


@dataclass
class ImageRecognitionContext:
    payload: dict
    evidence: dict
    sources: list
    review: RecognitionReview


def prepare_image_sources(payload):
    # Historical evidence uses sanitize_evidence's non-normalizing reader. Only
    # these fresh source facts pass through identifier normalization.
    raw_evidence = payload.get("recognition") or {}
    raw_sources = payload.get("imageSources") or (
        raw_evidence.get("sources") if isinstance(raw_evidence, dict) else None
    )
    evidence_input = (
        {key: value for key, value in raw_evidence.items() if key not in ("sources", "review")}
        if isinstance(raw_evidence, dict)
        else raw_evidence
    )
    evidence = sanitize_evidence(evidence_input)
    sources = sanitize_sources(raw_sources, normalize_identifiers=True)
    _check_image_identifiers(sources)
    review = RecognitionReview()
    merged = merge_sources(payload, evidence, sources, review=review)
    return ImageRecognitionContext(merged, evidence, sources, review)


def normalize_image_recognition(payload, model, normalize_payload):
    context = prepare_image_sources(payload)
    merged, evidence = context.payload, context.evidence
    month_source = evidence.get("fieldSources", {}).get("husbandryMonths", "")
    if month_source and not has_explicit_intake_date(evidence):
        merged["intakeDate"] = ""
    if month_source and not evidence.get("fieldSources", {}).get("endDate"):
        merged["endDate"] = ""
    item = normalize_payload(merged, month_evidence=month_source)
    item, evidence = normalize_image_result(merged, item, model, evidence=evidence, image_sources=context.sources)
    evidence["review"] = context.review.build(evidence, context.sources)
    return item, evidence
