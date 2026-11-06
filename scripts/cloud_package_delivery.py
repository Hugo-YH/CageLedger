"""Deliver committed ARM64 archives as verified private development draft attachments."""

import argparse
import hashlib
import json
import re
import shlex
import subprocess
import tarfile
import tempfile
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from container_archive import validate_archive
from gitea_git import git_environment
from gitea_release_assets import ORIGIN, AssetError, ReleaseAssets, download_script

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "ddns.cellnucle.us:3333/hugo/cageledger"
PLATFORM = "linux/arm64"
PROBE_NAME = "access-probe.txt"
PROBE_BODY = b"CageLedger draft-release raw download permission probe. No source or build identity.\n"
RESTORE_NAME = "RESTORE.txt"
DOWNLOAD_NAME = "CageLedger-download.py.txt"
PULL_NAME = "PULL.txt"


class DeliveryError(AssetError):
    pass


def require(condition, message):
    if not condition:
        raise DeliveryError(message)


def sha256_file(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def git(repo, *arguments):
    environment = git_environment()
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    result = subprocess.run(
        ["git", *arguments], cwd=repo, env=environment, capture_output=True, text=True, timeout=120, check=False
    )
    require(result.returncode == 0, f"Git {arguments[0]} failed; check the repository and HTTPS authentication.")
    return result.stdout.strip()


def source_identity(repo, *, check_remote):
    require(
        not git(repo, "status", "--porcelain=v1", "--untracked-files=all"), "Commit all source changes before delivery."
    )
    branch = git(repo, "branch", "--show-current")
    revision = git(repo, "rev-parse", "HEAD")
    require(bool(branch), "Delivery requires a named branch.")
    require(bool(re.fullmatch(r"[a-f0-9]{40}", revision)), "Invalid source revision.")
    package = json.loads((repo / "package.json").read_text())
    require(isinstance(package, dict), "Invalid source package.json.")
    app_version = package.get("version")
    require(
        isinstance(app_version, str) and bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}", app_version)),
        "Invalid application version.",
    )
    require(type(package.get("build")) is int, "Invalid application build number.")
    if check_remote:
        require(
            git(repo, "remote", "get-url", "gitea") == f"{ORIGIN}/hugo/cageledger.git",
            "Gitea remote must select the configured HTTPS repository.",
        )
        reference = f"refs/heads/{branch}"
        remote = git(repo, "ls-remote", "--exit-code", "gitea", reference).splitlines()
        require(remote == [f"{revision}\t{reference}"], "Gitea branch differs from the source revision; push it first.")
    return {"branch": branch, "revision": revision, "app_version": app_version, "app_build": package["build"]}


@dataclass(frozen=True)
class Artifact:
    path: Path
    size: int
    sha256: str

    @classmethod
    def read(cls, path):
        require(path.is_file() and not path.is_symlink(), f"Required regular artifact is missing: {path.name}")
        return cls(path, path.stat().st_size, sha256_file(path))

    def metadata(self):
        return {"name": self.path.name, "size": self.size, "sha256": self.sha256}

    def unchanged(self):
        return self.path.is_file() and self.path.stat().st_size == self.size and sha256_file(self.path) == self.sha256


@dataclass(frozen=True)
class Plan:
    repo: Path
    identity: dict
    version: str
    directory: Path
    manifest: bytes
    restore: bytes
    payloads: tuple
    official: bool = False
    offline_image: bool = True

    @property
    def tag(self):
        return "v" + self.version

    @property
    def manifest_path(self):
        return self.directory / f"CageLedger-build-{self.version}.json"

    def generated(self):
        generated = {
            self.manifest_path: self.manifest,
            self.directory / (RESTORE_NAME if self.offline_image else PULL_NAME): self.restore,
            self.directory / PROBE_NAME: PROBE_BODY,
        }
        if self.offline_image:
            generated[self.directory / DOWNLOAD_NAME] = download_script(
                self.tag,
                self.identity["revision"],
                self.manifest_path.name,
                hashlib.sha256(self.manifest).hexdigest(),
                official=self.official,
            )
        return generated

    def files(self):
        generated = tuple(
            Artifact(path, len(content), hashlib.sha256(content).hexdigest())
            for path, content in self.generated().items()
            if path.name != PROBE_NAME
        )
        return (*generated, *self.payloads)

    def probe(self):
        return Artifact(self.directory / PROBE_NAME, len(PROBE_BODY), hashlib.sha256(PROBE_BODY).hexdigest())


def write_immutable(path, content):
    if path.exists():
        require(
            path.is_file() and not path.is_symlink() and path.read_bytes() == content,
            f"Existing generated file differs: {path.name}",
        )
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as output:
        output.write(content)


def validate_source_archive(path, identity, repo):
    tracked = set(git(repo, "ls-files", "-z").split("\0")) - {""}
    forbidden = {
        ".git",
        ".env",
        "data",
        "node_modules",
        ".venv",
        ".codex-run",
        ".codex",
        ".gitea",
        ".github",
        "dist",
        "__pycache__",
        ".ruff_cache",
        "playwright-report",
        "test-results",
    }
    matched = set()
    seen = set()
    roots = set()
    package = None
    with tarfile.open(path, "r:gz") as archive:
        for entry in archive.getmembers():
            parts = Path(entry.name).parts
            require(parts and not Path(entry.name).is_absolute() and ".." not in parts, "Unsafe source archive path.")
            roots.add(parts[0])
            require(len(roots) == 1, "Offline source archive must have one root directory.")
            if len(parts) == 1:
                require(entry.isdir(), "Invalid source archive root.")
                continue
            relative = Path(*parts[1:]).as_posix()
            require(relative not in seen, "Duplicate source archive entry.")
            seen.add(relative)
            require(
                not any(part in forbidden for part in parts[1:]),
                "Source archive contains runtime or credential entries.",
            )
            require(
                not re.search(r"\.(?:sqlite3?|db)(?:-(?:wal|shm))?$", relative),
                "Source archive contains database entries.",
            )
            require(entry.isdir() or entry.isfile(), "Source archive contains non-regular entries.")
            if not entry.isfile():
                continue
            if relative in tracked:
                source = repo / relative
                require(source.is_file() and not source.is_symlink(), "Archived Git source is not a regular file.")
                with archive.extractfile(entry) as stream:
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()
                require(digest == sha256_file(source), f"Offline archive source differs from HEAD: {relative}")
                matched.add(relative)
            if relative == "package.json":
                require(entry.size <= 1024 * 1024, "Invalid archived package.json.")
                with archive.extractfile(entry) as stream:
                    package = json.load(stream)
    require(
        {"package.json", "server.py", "Dockerfile"} <= matched, "Offline archive lacks required committed source files."
    )
    require(
        isinstance(package, dict)
        and package.get("version") == identity["app_version"]
        and package.get("build") == identity["app_build"],
        "Offline source archive application version/build differs from the committed source.",
    )
    return len(matched)


def validate_checksums(checksums, notes, image):
    require(checksums.size <= 64 * 1024, "Unexpected checksum file size.")
    actual = {}
    for line in checksums.path.read_text().splitlines():
        match = re.fullmatch(r"([a-fA-F0-9]{64}) [ *](.+)", line)
        require(match is not None, "Invalid artifact checksum line.")
        name = Path(match[2]).name
        require(name not in actual, "Duplicate artifact checksum name.")
        actual[name] = match[1].lower()
    require(actual == {notes.path.name: notes.sha256, image.path.name: image.sha256}, "Artifact checksum file differs.")


def split_artifact(artifact, chunk_bytes, directory, *, write):
    if artifact.size <= chunk_bytes:
        return (artifact,)
    result = []
    combined = hashlib.sha256()
    with artifact.path.open("rb") as source:
        number = 0
        while source.tell() < artifact.size:
            number += 1
            require(number <= 9999, "Too many attachment chunks.")
            target = directory / f"{artifact.path.name.removesuffix('.gz')}.part{number:04d}.gz"
            temporary = None
            output = None
            try:
                if write:
                    directory.mkdir(parents=True, exist_ok=True)
                    output = tempfile.NamedTemporaryFile(mode="wb", dir=directory, prefix=".chunk-", delete=False)
                    temporary = Path(output.name)
                digest = hashlib.sha256()
                size = 0
                while size < chunk_bytes:
                    block = source.read(min(64 * 1024, chunk_bytes - size))
                    if not block:
                        break
                    digest.update(block)
                    combined.update(block)
                    size += len(block)
                    if output is not None:
                        output.write(block)
                require(size > 0, "Archive was truncated while splitting.")
                chunk = Artifact(target, size, digest.hexdigest())
                if output is not None:
                    output.close()
                    if target.exists() or target.is_symlink():
                        require(
                            not target.is_symlink() and chunk.unchanged(),
                            f"Existing local chunk differs: {target.name}",
                        )
                    else:
                        temporary.replace(target)
                result.append(chunk)
            finally:
                if output is not None:
                    output.close()
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
    require(
        sum(part.size for part in result) == artifact.size and combined.hexdigest() == artifact.sha256,
        "Archive changed while splitting.",
    )
    return tuple(result)


def prepare(
    repo,
    output,
    version=None,
    *,
    check_remote=True,
    chunk_bytes=8 * 1024 * 1024,
    write_parts=False,
    official=False,
    include_source=True,
    offline_image=None,
    registry_proof=None,
):
    identity = source_identity(repo, check_remote=check_remote)
    expected_version = (
        identity["app_version"] if official else f"{identity['app_version']}-dev.{identity['revision'][:12]}"
    )
    version = version or expected_version
    require(
        version == expected_version,
        "Official version must match package.json."
        if official
        else "Development draft version must identify the current application and source revision.",
    )
    require(0 < chunk_bytes <= 8 * 1024 * 1024, "Attachment chunk size must be greater than zero and at most 8 MiB.")
    app = identity["app_version"]
    source = Artifact.read(output / f"CageLedger-offline-{app}.tar.gz")
    image = Artifact.read(output / f"CageLedger-image-{app}-arm64.tar.gz")
    notes = Artifact.read(output / f"CageLedger-image-{app}-load.txt")
    checksums = Artifact.read(output / f"CageLedger-image-{app}-sha256.txt")
    count = validate_source_archive(source.path, identity, repo)
    validate_archive(image.path, "arm64", app, identity["revision"], f"{IMAGE}:{app}-arm64")
    validate_checksums(checksums, notes, image)
    require(source_identity(repo, check_remote=False) == identity, "Source changed during artifact verification.")
    offline_image = not official if offline_image is None else offline_image
    include_source = include_source and not official
    if official:
        require(
            isinstance(registry_proof, dict)
            and registry_proof.get("status") == "verified"
            and registry_proof.get("repository") == "git.cellnucle.us/hugo/cageledger"
            and registry_proof.get("version") == app
            and registry_proof.get("revision") == identity["revision"]
            and registry_proof.get("archive_sha256") == "sha256:" + image.sha256,
            "Official Release requires matching verified Container Package evidence.",
        )
    if not offline_image:
        require(official, "Development attachments require explicit --offline-image.")
        pull = (
            f"CageLedger {app} / linux/arm64\n\n"
            f"docker pull git.cellnucle.us/hugo/cageledger:{app}\n"
            f"docker pull git.cellnucle.us/hugo/cageledger@{registry_proof['index']['digest']}\n\n"
            "Docker reuses existing layers. This Release does not attach offline image/source archives.\n"
        ).encode()
        manifest = {
            "schema_version": 3,
            "delivery": "private-official-release-metadata",
            "version": version,
            "source": {"repository": f"{ORIGIN}/hugo/cageledger", **identity},
            "platforms": [PLATFORM],
            "source_archive_included": False,
            "source_archive_tracked_files_verified": count,
            "offline_image_included": False,
            "registry": registry_proof,
            "artifacts": [],
            "pull": {"name": PULL_NAME, "size": len(pull), "sha256": hashlib.sha256(pull).hexdigest()},
        }
        encoded = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
        return Plan(repo, identity, version, output / "cloud-delivery" / version, encoded, pull, (), True, False)
    directory = output / "cloud-delivery" / version
    records, payloads, commands = [], [], []
    for artifact in (source, notes, checksums, image) if include_source else (notes, checksums, image):
        pieces = split_artifact(artifact, chunk_bytes, directory / "parts", write=write_parts)
        records.append({**artifact.metadata(), "attachments": [part.metadata() for part in pieces]})
        payloads.extend(pieces)
        if len(pieces) > 1:
            commands.append(
                "cat "
                + " ".join(shlex.quote(part.path.name) for part in pieces)
                + " > "
                + shlex.quote(artifact.path.name)
            )
        commands.append(
            f"printf '%s  %s\\n' {shlex.quote(artifact.sha256)} {shlex.quote(artifact.path.name)} | shasum -a 256 -c -"
        )
    require(source_identity(repo, check_remote=False) == identity, "Source changed during artifact verification.")
    restore = (
        (
            "CageLedger ARM64 release archive restoration\n\n"
            if official
            else "CageLedger ARM64 development build archive restoration\n\n"
        )
        + "Alternatively run python3 CageLedger-download.py.txt to fetch and restore private attachments using an environment token or hidden prompt.\n\nDownload all attachments into one directory. Files ending in .partNNNN.gz are consecutive binary pieces, NOT independently decompressible gzip files. Concatenate only in the explicit order below, then verify the full archive SHA256 before extracting or docker load. Original archives are unchanged.\n\n"
        "set -eu\n" + "\n".join(commands) + "\n"
    ).encode()
    manifest = {
        "schema_version": 2,
        "delivery": "private-official-release" if official else "private-development-draft-release",
        "version": version,
        "source": {"repository": f"{ORIGIN}/hugo/cageledger", **identity},
        "platforms": [PLATFORM],
        "source_archive_tracked_files_verified": count,
        "image_tag": f"{IMAGE}:{app}-arm64",
        "chunk_bytes": chunk_bytes,
        "artifacts": records,
        "downloader": DOWNLOAD_NAME,
        "recovery": {"name": RESTORE_NAME, "size": len(restore), "sha256": hashlib.sha256(restore).hexdigest()},
    }
    if official:
        manifest["source_archive_included"] = include_source
        manifest["offline_image_included"] = True
        manifest["registry"] = registry_proof
    encoded = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    return Plan(repo, identity, version, directory, encoded, restore, tuple(payloads), official, offline_image)


def save_receipt(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=".receipt-", delete=False
    ) as stream:
        temporary = Path(stream.name)
        json.dump(value, stream, ensure_ascii=False, sort_keys=True, indent=2)
        stream.write("\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def release_payload(plan, ownership):
    revision = plan.identity["revision"]
    manifest_sha = hashlib.sha256(plan.manifest).hexdigest()
    return {
        "tag_name": plan.tag,
        "target_commitish": revision,
        "draft": True,
        "prerelease": True,
        "name": f"CageLedger {plan.identity['app_version']} development build {revision[:12]} (ARM64)",
        "body": (
            "Private development build from Codex cloud. This remains a draft and does not advance the official Release or latest image.\n\n"
            f"Source revision: `{revision}`. Target: `linux/arm64`. Application build: {plan.identity['app_build']}.\n"
            "Download all attachments, read RESTORE.txt, concatenate ordered binary chunks, and verify full SHA256 before use. No NAS deployment is performed.\n\n"
            f"<!-- cageledger-delivery-owner:{ownership}; manifest-sha256:{manifest_sha} -->"
        ),
    }


def verify_release(value, payload, receipt, actor):
    require(isinstance(value, dict) and type(value.get("id")) is int, "Invalid development draft metadata.")
    require(receipt.get("creation_intent") == payload, "Unknown draft ownership; not adopted.")
    require(
        all(
            value.get(key) == payload[key]
            for key in ("tag_name", "target_commitish", "draft", "prerelease", "name", "body")
        ),
        "Development draft metadata conflicts; not modified.",
    )
    author = value.get("author", {})
    require(
        author.get("id") == actor["id"] and author.get("login") == actor["login"],
        "Development draft has a different author; not adopted.",
    )
    require(
        receipt.get("release_id", value["id"]) == value["id"],
        "Development draft ID differs from the ownership receipt.",
    )
    return value["id"]


def ensure_release(plan, client, receipt, path):
    require(not plan.official, "Official plans require the release:cloud entry point.")
    repository_id, actor = client.repository(), client.actor()
    require(receipt.get("repository_id", repository_id) == repository_id, "Private source repository identity changed.")
    require(receipt.get("actor", actor) == actor, "Delivery actor changed; inspect ownership before resuming.")
    receipt.update(repository_id=repository_id, actor=actor)
    payload = release_payload(plan, receipt["ownership"])
    value = client.find(plan.tag)
    if value is None:
        require("release_id" not in receipt, "Owned draft disappeared; inspect before recreating it.")
        tag = git(plan.repo, "ls-remote", "gitea", f"refs/tags/{plan.tag}", f"refs/tags/{plan.tag}^{{}}")
        require(not tag, "Development tag already exists without an owned draft; not adopted.")
        receipt["creation_intent"] = payload
        save_receipt(path, receipt)  # Durable nonce/payload ownership BEFORE the external mutation.
        value = client.create(payload)
    release_id = verify_release(value, payload, receipt, actor)
    receipt["release_id"] = release_id
    save_receipt(path, receipt)
    return release_id, payload, actor


def attachment_identity(value):
    value = ReleaseAssets.attachment(value)
    # download_count changes during verification; these fields identify the immutable stored file.
    return {key: value.get(key) for key in ("id", "name", "size", "browser_download_url", "uuid", "created_at")}


def reusable_verification(record, artifact, attachment):
    if not isinstance(record, dict) or record.get("status") not in {"verified", "reused"}:
        return False
    if not all(record.get(key) == value for key, value in artifact.metadata().items()):
        return False
    if (
        record.get("attachment_id") != attachment["id"]
        or record.get("browser_download_url") != attachment["browser_download_url"]
    ):
        return False
    # Legacy receipts are eligible only when all original complete-hash proof fields above exist.
    return "attachment_identity" not in record or record["attachment_identity"] == attachment_identity(attachment)


def probe_privacy(plan, client, release_id, assets):
    probe = plan.probe()
    require(probe.size <= 256, "Permission probe must remain a tiny, source-free file.")
    if PROBE_NAME not in assets:
        require(probe.unchanged(), "Local permission probe changed.")
        attachment = client.upload(release_id, probe)
        require(attachment_identity(attachment)["name"] == PROBE_NAME, "Unexpected uploaded permission probe.")
        assets[PROBE_NAME] = attachment
    client.verify(assets[PROBE_NAME], probe)  # At most 256 authenticated bytes, only at run boundaries.
    proof = client.anonymous_denied(assets[PROBE_NAME])
    return proof, assets


def deliver(plan, client, state, *, audit_remote=False, ensure=None, verify=None):
    ensure, verify = ensure or ensure_release, verify or verify_release
    require(not state.resolve().is_relative_to(plan.repo.resolve()), "Delivery state must be outside the repository.")
    path = state / "receipt.json"
    identity = {
        "transport": (
            "private-official-release-v2-offline" if plan.offline_image else "private-official-release-v2-metadata"
        )
        if plan.official
        else "private-draft-release-v1",
        "source": plan.identity,
        "tag": plan.tag,
        "manifest_sha256": hashlib.sha256(plan.manifest).hexdigest(),
    }
    receipt = (
        json.loads(path.read_text()) if path.exists() else {"identity": identity, "ownership": uuid4().hex, "files": {}}
    )
    require(receipt.get("identity") == identity, "Existing receipt belongs to different artifacts or transport.")
    receipt["status"] = "running"
    receipt["verification"] = {
        "audit_remote": audit_remote,
        "fresh_full_hash_files": 0,
        "reused_hash_receipts": 0,
        "remote_artifact_bytes_verified_this_run": 0,
    }
    save_receipt(path, receipt)
    active = None
    try:
        for artifact_path, content in plan.generated().items():
            write_immutable(artifact_path, content)
        release_id, payload, actor = ensure(plan, client, receipt, path)
        assets = client.assets(release_id)
        allowed = {artifact.path.name for artifact in plan.files()} | {PROBE_NAME}
        require(set(assets) <= allowed, "Owned draft contains unknown attachments; inspect before resuming.")
        receipt["privacy"] = {"before": None, "after": None, "probe_size_bytes": plan.probe().size}
        save_receipt(path, receipt)
        receipt["privacy"]["before"], assets = probe_privacy(plan, client, release_id, assets)
        save_receipt(path, receipt)
        for artifact in plan.files():
            active = artifact.path.name
            require(artifact.unchanged(), f"Local artifact changed: {active}")
            existing = active in assets
            prior = receipt["files"].get(active)
            if existing and not audit_remote and reusable_verification(prior, artifact, assets[active]):
                scope = "prior_full_sha256_receipt"
                read_bytes = 0
                receipt["verification"]["reused_hash_receipts"] += 1
            else:
                pending = {**artifact.metadata(), "status": "verifying" if existing else "uploading"}
                if existing:
                    pending.update(
                        attachment_id=assets[active]["id"], browser_download_url=assets[active]["browser_download_url"]
                    )
                receipt["files"][active] = pending
                save_receipt(path, receipt)
                if not existing:
                    attachment = client.upload(release_id, artifact)
                    require(
                        attachment_identity(attachment)["name"] == active, "Unexpected uploaded attachment identity."
                    )
                    assets[active] = attachment
                client.verify(assets[active], artifact)  # Exactly one full byte/SHA read for a new or untrusted file.
                scope = "full_remote_sha256"
                read_bytes = artifact.size
                receipt["verification"]["fresh_full_hash_files"] += 1
                receipt["verification"]["remote_artifact_bytes_verified_this_run"] += artifact.size
            status = "reused" if existing else "verified"
            receipt["files"][active] = {
                **artifact.metadata(),
                "status": status,
                "attachment_id": assets[active]["id"],
                "browser_download_url": assets[active]["browser_download_url"],
                "attachment_identity": attachment_identity(assets[active]),
                "verification_scope": scope,
                "remote_bytes_hashed_this_run": read_bytes,
            }
            save_receipt(path, receipt)
            print(f"{status} ({scope}): {active}", flush=True)
        verify(client.release(release_id), payload, receipt, actor)
        require(client.repository() == receipt["repository_id"], "Private repository identity changed.")
        require(source_identity(plan.repo, check_remote=False) == plan.identity, "Source changed during upload.")
        final_assets = client.assets(release_id)
        require(set(final_assets) == allowed, "Final draft attachment set changed during delivery.")
        require(
            all(attachment_identity(final_assets[name]) == attachment_identity(assets[name]) for name in allowed),
            "Final draft attachment identity changed during delivery.",
        )
        receipt["privacy"]["after"], _ = probe_privacy(plan, client, release_id, final_assets)
        receipt["status"] = "verified_draft"
        save_receipt(path, receipt)
        return path
    except BaseException:
        receipt["status"] = "incomplete"
        if active and receipt["files"].get(active, {}).get("status") in {"uploading", "verifying"}:
            receipt["files"][active]["status"] = "unknown"
        save_receipt(path, receipt)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", help="Development version; must match <application-version>-dev.<revision12>")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    parser.add_argument("--state-dir", type=Path, help="Receipt directory outside the source checkout")
    parser.add_argument(
        "--image-only",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Compatibility option; source archives are never uploaded by this entry point",
    )
    parser.add_argument(
        "--chunk-mib",
        type=int,
        default=8,
        help="Maximum binary attachment piece size (default/max 8 MiB for this proxy)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Validate local artifacts/plan only; no network or generated-file writes"
    )
    parser.add_argument(
        "--audit-remote",
        action="store_true",
        help="Re-download and SHA256-audit every remote artifact instead of reusing complete hash receipts",
    )
    parser.add_argument(
        "--offline-image", action="store_true", help="Explicitly upload development offline image attachments"
    )
    options = parser.parse_args()
    require(
        options.offline_image,
        "Use publish:registry for normal delivery; add --offline-image only for a development offline attachment draft.",
    )
    require(1 <= options.chunk_mib <= 8, "--chunk-mib must be between 1 and 8.")
    plan = prepare(
        ROOT,
        options.output_dir.expanduser().resolve(),
        options.version,
        check_remote=not options.dry_run,
        chunk_bytes=options.chunk_mib * 1024 * 1024,
        write_parts=not options.dry_run,
        include_source=False,
    )
    if options.dry_run:
        print(
            json.dumps(
                {
                    "status": "validated_locally",
                    "remote_branch_verified": False,
                    "upload_performed": False,
                    "tag": plan.tag,
                    "files": [artifact.metadata() for artifact in plan.files()],
                },
                indent=2,
            )
        )
        return
    state = options.state_dir or ROOT.parent / f"{ROOT.name}-delivery-state" / plan.version
    path = deliver(plan, ReleaseAssets(), state.expanduser().resolve(), audit_remote=options.audit_remote)
    print(f"Private development draft attachments verified; receipt: {path}")
    print(f"{ORIGIN}/hugo/cageledger/releases/tag/{plan.tag}")


if __name__ == "__main__":
    try:
        main()
    except (AssetError, OSError, ValueError, tarfile.TarError, subprocess.SubprocessError) as error:
        if isinstance(error, AssetError):
            raise SystemExit(str(error)) from None
        raise SystemExit("Cloud draft delivery failed; inspect local artifacts and the external receipt.") from None
