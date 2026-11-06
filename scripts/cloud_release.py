"""Publish small ARM64 Package release metadata; offline attachments require explicit opt-in."""

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from datetime import UTC, datetime
from functools import partial
from pathlib import Path

import cloud_package_delivery as delivery
from cloud_registry import RegistryError
from cloud_release_registry import registry_evidence, verify_registry
from gitea_release_assets import API, ORIGIN, AssetError, ReleaseAssets

ROOT = delivery.ROOT
require = delivery.require


def validate_tag(repo, *, check_remote=True):
    source = delivery.source_identity(repo, check_remote=check_remote)
    require(source["branch"] == "main", "Stable cloud releases require main.")
    require(bool(re.fullmatch(r"\d+\.\d+\.\d+", source["app_version"])), "Stable release version required.")
    reference = "refs/tags/v" + source["app_version"]
    require(delivery.git(repo, "cat-file", "-t", reference) == "tag", "Annotated version tag required.")
    identity = {
        "reference": reference,
        "object": delivery.git(repo, "rev-parse", reference),
        "revision": delivery.git(repo, "rev-parse", reference + "^{commit}"),
    }
    require(identity["revision"] == source["revision"], "Version tag does not identify current HEAD.")
    if check_remote:
        values = delivery.git(repo, "ls-remote", "--exit-code", "gitea", reference, reference + "^{}")
        require(
            set(values.splitlines())
            == {
                identity["object"] + "\t" + reference,
                source["revision"] + "\t" + reference + "^{}",
            },
            "Remote annotated tag object/peeled revision differs from the local release.",
        )
    return identity


def release_notes(repo, version):
    with tempfile.TemporaryDirectory(prefix="cageledger-cloud-release-notes-") as directory:
        result = subprocess.run(
            ["node", "scripts/release_notes_payload.mjs", "--version", version, "--output-dir", directory],
            cwd=repo,
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )
        require(result.returncode == 0, "Authoritative version notes are missing or invalid.")
        payload = json.loads((Path(directory) / "release-create.json").read_text())
    require(payload.get("tag_name") == "v" + version and payload.get("body", "").strip(), "Wrong release notes.")
    return payload["body"].strip()


def release_payload(plan, ownership, notes):
    require(plan.official, "Official release plan required.")
    require(isinstance(notes, str) and notes.strip(), "Official release notes required.")
    revision = plan.identity["revision"]
    manifest_sha = hashlib.sha256(plan.manifest).hexdigest()
    package = json.loads(plan.manifest)["registry"]
    instructions = (
        f"ARM64 镜像已在 Gitea Packages 核验。\n\n"
        f"```sh\ndocker pull {package['repository']}:{plan.version}\n"
        f"docker pull {package['repository']}@{package['index']['digest']}\n```\n\n"
        f"ARM64 manifest: `{package['manifest']['digest']}`. "
        f"Image config: `{package['config']['digest']}`.\n\n"
    )
    instructions += (
        "下载附件中的 `CageLedger-download.py.txt`，运行 `python3 CageLedger-download.py.txt` "
        "恢复 ARM64 镜像包；或按 `RESTORE.txt` 顺序合并分片并核对完整 SHA256。分片不能单独解压。\n\n"
        if plan.offline_image
        else "附件仅含来源与摘要清单及 `PULL.txt`；Docker 可复用已有镜像层。没有附加离线镜像包或源码包。\n\n"
    )
    return {
        "tag_name": plan.tag,
        "target_commitish": revision,
        "draft": True,
        "prerelease": False,
        "name": f"CageLedger {plan.version}（Build {plan.identity['app_build']}） (ARM64)",
        "body": notes.strip()
        + "\n\n---\n\n"
        + f"Source revision: `{revision}`. Target: `linux/arm64`.\n\n"
        + instructions
        + "此流程不移动 Registry 的 latest 标签，不部署 NAS。\n\n"
        + f"<!-- cageledger-delivery-owner:{ownership}; manifest-sha256:{manifest_sha} -->",
    }


def verify_release(value, payload, receipt, actor):
    delivery.verify_release(value, payload, receipt, actor)
    require(payload["prerelease"] is False and payload["draft"] is True, "Invalid official draft intent.")
    return value["id"]


def ensure_release(plan, client, receipt, path, *, notes):
    tag = validate_tag(plan.repo)
    require(receipt.get("tag_identity", tag) == tag, "Annotated tag changed since release creation.")
    repository_id, actor = client.repository(), client.actor()
    require(receipt.get("repository_id", repository_id) == repository_id, "Private repository identity changed.")
    require(receipt.get("actor", actor) == actor, "Release author changed.")
    receipt.update(repository_id=repository_id, actor=actor, tag_identity=tag)
    payload = release_payload(plan, receipt["ownership"], notes)
    value = client.find(plan.tag)
    if value is None:
        require("release_id" not in receipt, "Owned official draft disappeared; inspect before recreating.")
        receipt["creation_intent"] = payload
        delivery.save_receipt(path, receipt)
        value = client.create(payload)
    release_id = verify_release(value, payload, receipt, actor)
    receipt["release_id"] = release_id
    delivery.save_receipt(path, receipt)
    return release_id, payload, actor


def expected_identity(plan):
    return {
        "transport": "private-official-release-v2-offline"
        if plan.offline_image
        else "private-official-release-v2-metadata",
        "source": plan.identity,
        "tag": plan.tag,
        "manifest_sha256": hashlib.sha256(plan.manifest).hexdigest(),
    }


def verify_snapshot(plan, client, receipt):
    expected = {artifact.path.name: artifact for artifact in plan.files()}
    records = receipt.get("files", {})
    require(set(records) == set(expected), "Publication requires the complete verified attachment receipt.")
    assets = client.assets(receipt["release_id"])
    require(set(assets) == set(expected) | {delivery.PROBE_NAME}, "Official attachment set changed.")
    for name, artifact in expected.items():
        record = records[name]
        require(
            delivery.reusable_verification(record, artifact, assets[name])
            and record.get("attachment_identity") == delivery.attachment_identity(assets[name])
            and record.get("verification_scope") in {"full_remote_sha256", "prior_full_sha256_receipt"},
            "Publication requires complete matching SHA256/attachment identity proof: " + name,
        )
    return assets


def verify_published(value, payload, receipt, actor):
    draft_payload = {**payload, "draft": True}
    require(receipt.get("creation_intent") == draft_payload, "Unknown official release ownership.")
    require(receipt.get("publish_intent") == payload, "Missing durable publication intent.")
    proxy_receipt = {**receipt, "creation_intent": payload}
    delivery.verify_release(value, payload, proxy_receipt, actor)
    date = value.get("published_at")
    require(isinstance(date, str), "Release publication timestamp is missing.")
    published_at = datetime.fromisoformat(date.replace("Z", "+00:00"))
    require(
        published_at.tzinfo is not None and published_at > datetime(1970, 1, 2, tzinfo=UTC),
        "Release publication timestamp is an epoch placeholder.",
    )


def publish_verified(plan, client, state, *, notes):
    require(not state.resolve().is_relative_to(plan.repo.resolve()), "Release state must be outside the checkout.")
    path = state / "receipt.json"
    require(path.is_file(), "Publication requires a verified draft receipt.")
    receipt = json.loads(path.read_text())
    require(receipt.get("identity") == expected_identity(plan), "Publication receipt belongs to another build.")
    require(
        receipt.get("status") in {"verified_draft", "publish_pending", "published"},
        "Publication requires a completed verified draft, not an incomplete upload.",
    )
    require(
        receipt.get("privacy", {}).get("after", {}).get("raw_attachment_access") in {"denied", "same_origin_login"},
        "Publication requires a successful raw attachment privacy check.",
    )
    registry = verify_registry(plan)
    require(receipt.get("tag_identity") == validate_tag(plan.repo), "Annotated release tag changed.")
    require(client.repository() == receipt.get("repository_id"), "Private repository identity changed.")
    actor = client.actor()
    require(actor == receipt.get("actor"), "Release author changed.")
    draft = release_payload(plan, receipt["ownership"], notes)
    final = {**draft, "draft": False}
    value = client.release(receipt["release_id"])
    if value.get("draft") is True:
        verify_release(value, draft, receipt, actor)
    else:
        verify_published(value, final, receipt, actor)
    assets = verify_snapshot(plan, client, receipt)
    receipt["publication_privacy_before"], _ = delivery.probe_privacy(plan, client, value["id"], assets)
    require(all(artifact.unchanged() for artifact in plan.files()), "Local release artifacts changed.")
    if value.get("draft") is True:
        receipt.update(status="publish_pending", publish_intent=final)
        delivery.save_receipt(path, receipt)  # Publication intent survives an unknown PATCH response.
        client.json("PATCH", f"{API}/releases/{value['id']}", value={"draft": False})
    value = client.release(value["id"])
    verify_published(value, final, receipt, actor)
    require(receipt["tag_identity"] == validate_tag(plan.repo), "Release references changed during publication.")
    require(client.repository() == receipt["repository_id"], "Repository privacy changed during publication.")
    assets = verify_snapshot(plan, client, receipt)
    receipt["publication_privacy_after"], _ = delivery.probe_privacy(plan, client, value["id"], assets)
    receipt.update(
        status="published",
        publication={
            "release_id": value["id"],
            "tag": plan.tag,
            "revision": plan.identity["revision"],
            "published_at": value["published_at"],
            "url": f"{ORIGIN}/hugo/cageledger/releases/tag/{plan.tag}",
            "registry_verified": True,
            "registry_index": registry["index"]["digest"],
            "nas_deployed": False,
        },
    )
    delivery.save_receipt(path, receipt)
    return path


def release(plan, client, state, *, notes, publish=False, audit_remote=False):
    require(plan.official, "Official release plan required.")
    require(not state.resolve().is_relative_to(plan.repo.resolve()), "Release state must be outside the checkout.")
    path = state / "receipt.json"
    prior = json.loads(path.read_text()) if path.exists() else {}
    if prior.get("publish_intent"):
        require(publish, "This release has a publication intent; resume with --publish.")
        return publish_verified(plan, client, state, notes=notes)
    verify_registry(plan)
    validate_tag(plan.repo)
    path = delivery.deliver(
        plan,
        client,
        state,
        audit_remote=audit_remote,
        ensure=partial(ensure_release, notes=notes),
        verify=verify_release,
    )
    return publish_verified(plan, client, state, notes=notes) if publish else path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    parser.add_argument("--state-dir", type=Path)
    parser.add_argument("--registry-state-dir", type=Path, help="Matching verified publish:registry state directory")
    parser.add_argument(
        "--offline-image", action="store_true", help="Also upload the full offline ARM64 image attachments"
    )
    parser.add_argument(
        "--publish", action="store_true", help="Publish after Package and small attachment verification"
    )
    parser.add_argument("--dry-run", action="store_true", help="Validate local tag/artifacts/notes only; no upload")
    parser.add_argument("--audit-remote", action="store_true")
    parser.add_argument(
        "--image-only",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Compatibility option; source archives are never uploaded by this entry point",
    )
    options = parser.parse_args()
    validate_tag(ROOT, check_remote=not options.dry_run)
    source = delivery.source_identity(ROOT, check_remote=False)
    registry_state = options.registry_state_dir or ROOT.parent / f"{ROOT.name}-registry-state" / source["app_version"]
    proof = registry_evidence(
        options.output_dir.expanduser().resolve(), registry_state.expanduser().resolve(), source=source
    )
    plan = delivery.prepare(
        ROOT,
        options.output_dir.expanduser().resolve(),
        official=True,
        check_remote=not options.dry_run,
        write_parts=options.offline_image and not options.dry_run,
        include_source=False,
        offline_image=options.offline_image,
        registry_proof=proof,
    )
    notes = release_notes(ROOT, plan.version)
    if options.dry_run:
        print(
            json.dumps(
                {
                    "status": "validated_locally",
                    "tag": plan.tag,
                    "publish_requested": options.publish,
                    "remote_verified": False,
                    "upload_performed": False,
                },
                indent=2,
            )
        )
        return
    state = options.state_dir or ROOT.parent / f"{ROOT.name}-release-state" / plan.version
    path = release(
        plan,
        ReleaseAssets(),
        state.expanduser().resolve(),
        notes=notes,
        publish=options.publish,
        audit_remote=options.audit_remote,
    )
    print(f"{'Published official release' if options.publish else 'Verified official draft'}; receipt: {path}")
    print(f"{ORIGIN}/hugo/cageledger/releases/tag/{plan.tag}")
    print("Registry tags/latest and production NAS were not changed.")


if __name__ == "__main__":
    try:
        main()
    except (AssetError, RegistryError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        raise SystemExit(
            str(error)
            if isinstance(error, AssetError | RegistryError)
            else "Official cloud release failed; preserve the receipt and inspect the current remote state."
        ) from None
