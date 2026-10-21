"""Shared intake-purpose compatibility rules."""


def intake_purpose(batch):
    return "direct_sampling" if batch.get("intakePurpose") == "direct_sampling" else "housing"


def is_direct_sampling(batch):
    return intake_purpose(batch) == "direct_sampling"
