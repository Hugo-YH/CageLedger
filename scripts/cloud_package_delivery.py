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

    @property
    def tag(self):
        return "v" + self.version

    @property
    def manifest_path(self):
        return self.directory / f"CageLedger-build-{self.version}.json"

    def generated(self):
        return {
            self.manifest_path: self.manifest,
            self.directory / RESTORE_NAME: self.restore,
            self.directory / PROBE_NAME: PROBE_BODY,
            self.directory / DOWNLOAD_NAME: download_script(
                self.tag, self.identity["revision"], self.manifest_path.name, hashlib.sha256(self.manifest).hexdigest()
            ),
        }

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


def prepare(repo, output, version=None, *, check_remote=True, chunk_bytes=8 * 1024 * 1024, write_parts=False):
    identity = source_identity(repo, check_remote=check_remote)
    expected_version = f"{identity['app_version']}-dev.{identity['revision'][:12]}"
    version = version or expected_version
    require(
        version == expected_version,
        "Development draft version must identify the current application and source revision.",
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
    directory = output / "cloud-delivery" / version
    records, payloads, commands = [], [], []
    for artifact in (source, notes, checksums, image):
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
        "CageLedger ARM64 development build archive restoration\n\n"
        "Alternatively run python3 CageLedger-download.py.txt to fetch and restore private attachments using an environment token or hidden prompt.\n\nDownload all attachments into one directory. Files ending in .partNNNN.gz are consecutive binary pieces, NOT independently decompressible gzip files. Concatenate only in the explicit order below, then verify the full archive SHA256 before extracting or docker load. Original archives are unchanged.\n\n"
        "set -eu\n" + "\n".join(commands) + "\n"
    ).encode()
    manifest = {
        "schema_version": 2,
        "delivery": "private-development-draft-release",
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
    encoded = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    return Plan(repo, identity, version, directory, encoded, restore, tuple(payloads))


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


def probe_privacy(plan, client, release_id, assets):
    probe = plan.probe()
    if PROBE_NAME not in assets:
        require(probe.unchanged(), "Local permission probe changed.")
        client.upload(release_id, probe)
        assets = client.assets(release_id)
    require(PROBE_NAME in assets, "Permission probe upload is not visible.")
    client.verify(assets[PROBE_NAME], probe)
    proof = client.anonymous_denied(assets[PROBE_NAME])
    return proof, assets


def deliver(plan, client, state):
    require(not state.resolve().is_relative_to(plan.repo.resolve()), "Delivery state must be outside the repository.")
    path = state / "receipt.json"
    identity = {
        "transport": "private-draft-release-v1",
        "source": plan.identity,
        "tag": plan.tag,
        "manifest_sha256": hashlib.sha256(plan.manifest).hexdigest(),
    }
    receipt = (
        json.loads(path.read_text()) if path.exists() else {"identity": identity, "ownership": uuid4().hex, "files": {}}
    )
    require(receipt.get("identity") == identity, "Existing receipt belongs to different artifacts or transport.")
    receipt["status"] = "running"
    save_receipt(path, receipt)
    active = None
    try:
        for artifact_path, content in plan.generated().items():
            write_immutable(artifact_path, content)
        release_id, payload, actor = ensure_release(plan, client, receipt, path)
        assets = client.assets(release_id)
        allowed = {artifact.path.name for artifact in plan.files()} | {PROBE_NAME}
        require(set(assets) <= allowed, "Owned draft contains unknown attachments; inspect before resuming.")
        receipt["privacy"] = {"status": "checking_raw_attachment"}
        save_receipt(path, receipt)
        receipt["privacy"], assets = probe_privacy(plan, client, release_id, assets)
        save_receipt(path, receipt)
        for artifact in plan.files():
            active = artifact.path.name
            require(artifact.unchanged(), f"Local artifact changed: {active}")
            verify_release(client.release(release_id), payload, receipt, actor)
            require(client.repository() == receipt["repository_id"], "Private repository identity changed.")
            receipt["privacy"], assets = probe_privacy(plan, client, release_id, assets)
            if active in assets:
                client.verify(assets[active], artifact)  # Re-read complete bytes; no server SHA is assumed.
                status = "reused"
            else:
                receipt["files"][active] = {**artifact.metadata(), "status": "uploading"}
                save_receipt(path, receipt)
                client.upload(release_id, artifact)
                assets = client.assets(release_id)
                require(active in assets, "Uploaded attachment is not visible.")
                client.verify(assets[active], artifact)
                status = "verified"
            receipt["files"][active] = {
                **artifact.metadata(),
                "status": status,
                "attachment_id": assets[active]["id"],
                "browser_download_url": assets[active]["browser_download_url"],
            }
            save_receipt(path, receipt)
            print(f"{status}: {active}", flush=True)
        verify_release(client.release(release_id), payload, receipt, actor)
        require(client.repository() == receipt["repository_id"], "Private repository identity changed.")
        require(source_identity(plan.repo, check_remote=False) == plan.identity, "Source changed during upload.")
        receipt["privacy"], _ = probe_privacy(plan, client, release_id, client.assets(release_id))
        receipt["status"] = "verified_draft"
        save_receipt(path, receipt)
        return path
    except BaseException:
        receipt["status"] = "incomplete"
        if active and receipt["files"].get(active, {}).get("status") == "uploading":
            receipt["files"][active]["status"] = "unknown"
        save_receipt(path, receipt)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", help="Development version; must match <application-version>-dev.<revision12>")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    parser.add_argument("--state-dir", type=Path, help="Receipt directory outside the source checkout")
    parser.add_argument(
        "--chunk-mib",
        type=int,
        default=8,
        help="Maximum binary attachment piece size (default/max 8 MiB for this proxy)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Validate local artifacts/plan only; no network or generated-file writes"
    )
    options = parser.parse_args()
    require(1 <= options.chunk_mib <= 8, "--chunk-mib must be between 1 and 8.")
    plan = prepare(
        ROOT,
        options.output_dir.expanduser().resolve(),
        options.version,
        check_remote=not options.dry_run,
        chunk_bytes=options.chunk_mib * 1024 * 1024,
        write_parts=not options.dry_run,
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
    path = deliver(plan, ReleaseAssets(), state.expanduser().resolve())
    print(f"Private development draft attachments verified; receipt: {path}")
    print(f"{ORIGIN}/hugo/cageledger/releases/tag/{plan.tag}")


if __name__ == "__main__":
    try:
        main()
    except (AssetError, OSError, ValueError, tarfile.TarError, subprocess.SubprocessError) as error:
        if isinstance(error, AssetError):
            raise SystemExit(str(error)) from None
        raise SystemExit("Cloud draft delivery failed; inspect local artifacts and the external receipt.") from None
