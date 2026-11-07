"""Verified image bytes only; callers always recheck current remote visibility."""

import hashlib
import re
from pathlib import Path

from . import files, repository
from .gitea import safe_etag


def _cached(root, item, identity):
    if item.get("cache_identity") != identity or not re.fullmatch(r"[0-9a-f]{64}", item.get("cache_sha256", "")):
        return None
    path = Path(root) / item["storage_name"]
    if path.resolve().parent != Path(root).resolve() or item["mime"] not in {
        mime for mime, _ in files.FORMATS.values()
    }:
        return None
    try:
        with path.open("rb") as stream:
            content = stream.read(files.MAX_BYTES + 1)
    except OSError:
        return None
    if not content or len(content) > files.MAX_BYTES or len(content) != item["size"]:
        return None
    return content if hashlib.sha256(content).hexdigest() == item["cache_sha256"] else None


def load(client, root, item, parent_path, metadata):
    url = metadata.get("browser_download_url", "")
    identity = hashlib.sha256(
        repository.encode(
            [
                client.repository,
                item["feedback_id"],
                parent_path,
                item["remote_id"],
                url,
            ]
        ).encode()
    ).hexdigest()
    cached = _cached(root, item, identity)
    content, etag = client.download_asset_version(url, validator=item.get("cache_etag", ""), cached=cached)
    digest = hashlib.sha256(content).hexdigest()
    if cached is not None and digest == item["cache_sha256"]:
        mime, storage = item["mime"], item["storage_name"]
    else:
        mime, suffix = files.validate(content)
        storage = item["id"] + suffix
        files.store(root, storage, content)
    return content, {
        "storage_name": storage,
        "mime": mime,
        "size": len(content),
        "cache_sha256": digest,
        "cache_etag": safe_etag(etag),
        "cache_identity": identity,
    }
