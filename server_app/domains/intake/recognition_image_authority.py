"""Bound image facts that may replace a previously text-only appointment."""

from . import recognition_matching as rules
from .recognition_sex import image_sex_matches


def incoming_image_fields(existing, incoming, images):
    evidence = incoming.get("recognition") or {}
    if (existing.get("recognition") or {}).get("images") or not images or not evidence.get("inputImages"):
        return set()
    # An image is authoritative only for facts actually present in this round.
    allowed = {"quantity", "strainRaw", "strainStandard", "specification", "sex", "supplier", "roomName"}
    allowed.update(("husbandryDays", "husbandryMonths"))
    fields = {field for field in allowed if field != "sex" and (evidence.get("fieldSources") or {}).get(field)}
    if evidence.get("sources"):
        from .recognition_pipeline import prepare_image_sources

        fields = set()
        context = prepare_image_sources(incoming)
        for field in allowed:
            if field == "sex":
                continue
            explicit = any(not rules.missing(source.get(field)) for source in context.sources)
            if field in ("strainRaw", "strainStandard"):
                explicit = any(source.get("strainRaw") or source.get("productName") for source in context.sources)
            if field == "husbandryMonths":
                explicit = bool(context.payload.get(field))
            if explicit and rules.key(field, rules.value(incoming, field)) == rules.key(
                field, rules.value(context.payload, field)
            ):
                fields.add(field)
    if image_sex_matches(incoming):
        fields.add("sex")
    return {field for field in fields if not rules.missing(incoming.get(field))}
