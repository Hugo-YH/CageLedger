"""Bind small Release metadata to a previously published, live ARM64 Container Package."""

import hashlib
import json
from pathlib import Path

import cloud_registry as registry

IMAGE_REPOSITORY = "git.cellnucle.us/hugo/cageledger"


def registry_evidence(output, state, *, source):
    """Read local successful publication proof; live checks happen at release boundaries."""
    archive = Path(output) / f"CageLedger-image-{source['app_version']}-arm64.tar.gz"
    receipt = registry.read_json(Path(state) / "registry-receipt.json")
    registry.require(
        receipt.get("status") == "verified", "Release requires the matching verified Container Package publication."
    )
    plan = registry.prepare_archive(archive, state, source["app_version"], source["revision"])
    registry.require(
        receipt.get("identity") == plan["identity"],
        "Release requires the matching verified Container Package publication.",
    )
    for reference, item in (
        (source["app_version"] + "-arm64", plan["manifest"]),
        (source["app_version"], plan["index"]),
    ):
        record = receipt.get("tags", {}).get(reference, {})
        registry.require(
            record.get("status") == "verified"
            and record.get("intent") == {"digest": item["digest"], "mediaType": item["mediaType"]},
            "Container Package tag proof is missing.",
        )
    result = {
        "status": "verified",
        "repository": IMAGE_REPOSITORY,
        "version": source["app_version"],
        "revision": source["revision"],
        "archive_sha256": plan["identity"]["archive_sha256"],
    }
    for key in ("manifest", "index", "config"):
        result[key] = {name: plan[key][name] for name in ("digest", "size", "mediaType")}
    return result


def verify_registry(plan, *, client=None):
    evidence = json.loads(plan.manifest).get("registry", {})
    registry.require(
        evidence.get("status") == "verified"
        and evidence.get("repository") == IMAGE_REPOSITORY
        and evidence.get("version") == plan.identity["app_version"]
        and evidence.get("revision") == plan.identity["revision"],
        "Release is not bound to a verified matching Container Package.",
    )
    client = client or registry.Client()
    child = client.manifest(evidence["version"] + "-arm64")
    index = client.manifest(evidence["version"])
    registry.require(
        child and child[0] == evidence["manifest"]["digest"] and index and index[0] == evidence["index"]["digest"],
        "Container Package registry digest changed.",
    )
    registry.require(
        index[1].get("manifests") == [{**evidence["manifest"], "platform": {"os": "linux", "architecture": "arm64"}}],
        "Container Package is not ARM64-only.",
    )
    config = child[1].get("config", {})
    registry.require(
        all(config.get(key) == value for key, value in evidence["config"].items()),
        "Container Package config descriptor changed.",
    )
    status, _, body = client.request("GET", registry.BASE + "/blobs/" + config["digest"])
    registry.require(
        status == 200
        and len(body) == config["size"]
        and "sha256:" + hashlib.sha256(body).hexdigest() == config["digest"],
        "Container Package config bytes changed.",
    )
    registry.check_config(json.loads(body), evidence["version"], evidence["revision"])
    for item in [config, *child[1].get("layers", [])]:
        status, headers, _ = client.request("HEAD", registry.BASE + "/blobs/" + item["digest"], missing=True)
        registry.require(
            status == 200
            and headers.get("Docker-Content-Digest") == item["digest"]
            and int(headers.get("Content-Length", -1)) == item["size"],
            "Container Package blob is missing.",
        )
    return evidence
