"""Presentation helpers for the versioned animal inspection catalog."""

from server_app.shared import clean_text


def prepare_catalog_payload(payload):
    """Attach protected reference URLs and reuse matching images within one module."""
    image_sets = {}
    for node in payload["nodes"]:
        config = node.get("config") or {}
        images = list(config.get("referenceImages") or [])
        if images:
            image_sets.setdefault(catalog_image_key(node), images)

    for node in payload["nodes"]:
        config = node.get("config") or {}
        images = list(config.get("referenceImages") or [])
        origin = "exact" if images else ""
        if not images:
            images = image_sets.get(catalog_image_key(node), [])
            origin = "same_name" if images else ""
        if images:
            config["referenceImages"] = [protected_reference_image(image) for image in images]
            config["referenceOrigin"] = origin
        node["config"] = config
    return payload


def catalog_image_key(node):
    return clean_text(node.get("moduleCode") or node.get("module_code")).lower(), clean_text(node.get("name")).lower()


def protected_reference_image(image):
    result = dict(image)
    source_url = clean_text(result.get("url"))
    filename = source_url.rsplit("/", 1)[-1]
    if filename:
        result["url"] = f"/api/animal-inspection-reference/{filename}"
    return result
