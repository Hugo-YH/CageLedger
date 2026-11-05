"""Upload committed ARM64 development artifacts to immutable Gitea Generic Packages."""

import argparse
import hashlib
import http.client
import json
import os
import re
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from container_archive import validate_archive
from gitea_git import git_environment

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://git.cellnucle.us"
OWNER = "hugo"
PACKAGE = "cageledger-cloud-build"
IMAGE = "ddns.cellnucle.us:3333/hugo/cageledger"
PLATFORM = "linux/arm64"
BOOTSTRAP_VERSION = "privacy-bootstrap-v1"
BOOTSTRAP_FILE = "package-link.txt"
BOOTSTRAP_BODY = b"Gitea package privacy binding bootstrap. No application source or build identity.\n"
MAX_METADATA = 4 * 1024 * 1024


class DeliveryError(RuntimeError):
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
    manifest_path: Path
    manifest: bytes
    artifacts: tuple

    def manifest_artifact(self):
        return Artifact(self.manifest_path, len(self.manifest), hashlib.sha256(self.manifest).hexdigest())

    def files(self):
        return (self.manifest_artifact(), *self.artifacts)


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


def prepare(repo, output, version=None, *, check_remote=True):
    identity = source_identity(repo, check_remote=check_remote)
    version = version or f"{identity['app_version']}-dev.{identity['revision'][:12]}"
    require(bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}", version)), "Invalid Generic Package version.")
    app = identity["app_version"]
    source = Artifact.read(output / f"CageLedger-offline-{app}.tar.gz")
    image = Artifact.read(output / f"CageLedger-image-{app}-arm64.tar.gz")
    notes = Artifact.read(output / f"CageLedger-image-{app}-load.txt")
    checksums = Artifact.read(output / f"CageLedger-image-{app}-sha256.txt")
    archived_source_count = validate_source_archive(source.path, identity, repo)
    validate_archive(image.path, "arm64", app, identity["revision"], f"{IMAGE}:{app}-arm64")
    validate_checksums(checksums, notes, image)
    require(source_identity(repo, check_remote=False) == identity, "Source changed during artifact verification.")
    artifacts = (source, notes, checksums, image)
    manifest = {
        "schema_version": 1,
        "package": PACKAGE,
        "version": version,
        "source": {"repository": f"{ORIGIN}/hugo/cageledger", **identity},
        "platforms": [PLATFORM],
        "source_archive_tracked_files_verified": archived_source_count,
        "image_tag": f"{IMAGE}:{app}-arm64",
        "artifacts": [artifact.metadata() for artifact in artifacts],
    }
    encoded = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    return Plan(repo, identity, version, output / f"CageLedger-build-{version}.json", encoded, artifacts)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Gitea:
    def __init__(self, token=None, *, origin=ORIGIN, opener=None):
        require(origin.rstrip("/") == ORIGIN, "Delivery requires the configured HTTPS Gitea origin.")
        token = token if token is not None else os.environ.get("CAGELEDGER_GITEA_TOKEN", "")
        require(
            bool(token) and not any(char.isspace() for char in token),
            "A valid CAGELEDGER_GITEA_TOKEN binding is required.",
        )
        self.authorization = "token " + token
        # Default ProxyHandler and verified HTTPSHandler retain the session proxy/CA trust.
        self.opener = opener or urllib.request.build_opener(NoRedirect())

    def request(self, method, path, *, stream=None, size=None, missing=False):
        parsed = urllib.parse.urlsplit(path)
        require(
            path.startswith("/api/") and not parsed.scheme and not parsed.netloc and not parsed.fragment,
            "Invalid Gitea API path.",
        )
        headers = {"Authorization": self.authorization, "Accept": "application/json"}
        if stream is not None:
            headers.update({"Content-Type": "application/octet-stream", "Content-Length": str(size)})
        request = urllib.request.Request(ORIGIN + path, data=stream, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=120) as response:
                body = response.read(MAX_METADATA + 1)
                require(len(body) <= MAX_METADATA, f"Gitea metadata exceeds the limit: {path}")
                return body
        except urllib.error.HTTPError as error:
            if error.code == 404 and missing:
                return None
            raise DeliveryError(f"Gitea {method} {path}: HTTP {error.code}") from None
        except (OSError, urllib.error.URLError, TimeoutError, http.client.HTTPException):
            raise DeliveryError(
                f"Gitea {method} {path}: network request failed; inspect the receipt before resuming."
            ) from None

    def metadata(self, path, *, missing=False):
        body = self.request("GET", path, missing=missing)
        if body is None:
            return None
        try:
            return json.loads(body)
        except (ValueError, TypeError):
            raise DeliveryError(f"Invalid Gitea package metadata: {path}") from None

    def repository(self):
        value = self.metadata("/api/v1/repos/hugo/cageledger")
        require(
            isinstance(value, dict)
            and type(value.get("id")) is int
            and value.get("full_name") == "hugo/cageledger"
            and value.get("private") is True,
            "Delivery requires the verified private hugo/cageledger repository.",
        )
        return value["id"]

    def versions(self):
        versions = []
        for page in range(1, 1001):
            query = urllib.parse.urlencode({"type": "generic", "q": PACKAGE, "limit": 50, "page": page})
            values = self.metadata(f"/api/v1/packages/{OWNER}?{query}")
            require(isinstance(values, list), "Invalid Gitea package version list.")
            for value in values:
                require(isinstance(value, dict), "Invalid Gitea package version metadata.")
                if value.get("name") == PACKAGE and value.get("type") == "generic":
                    require(isinstance(value.get("version"), str), "Missing Generic Package version.")
                    versions.append(value)
            if len(values) < 50:
                return versions
        raise DeliveryError("Gitea package version pagination exceeded the limit.")

    def verify_private(self, version, repository_id):
        quoted = urllib.parse.quote(version, safe="")
        value = self.metadata(f"/api/v1/packages/{OWNER}/generic/{PACKAGE}/{quoted}")
        repository = value.get("repository") if isinstance(value, dict) else None
        require(
            isinstance(repository, dict)
            and repository.get("id") == repository_id
            and repository.get("full_name") == "hugo/cageledger"
            and repository.get("private") is True,
            "Package is not verified as linked to the private hugo/cageledger repository; source upload refused.",
        )

    def ensure_private(self):
        repository_id = self.repository()
        versions = self.versions()
        marker = {
            "name": BOOTSTRAP_FILE,
            "size": len(BOOTSTRAP_BODY),
            "sha256": hashlib.sha256(BOOTSTRAP_BODY).hexdigest(),
        }
        if versions and all(value.get("repository") is not None for value in versions):
            for value in versions:
                repository = value["repository"]
                require(
                    isinstance(repository, dict)
                    and repository.get("id") == repository_id
                    and repository.get("full_name") == "hugo/cageledger"
                    and repository.get("private") is True,
                    "Existing package is linked to a different or non-private repository; not relinked.",
                )
            anchor = sorted(value["version"] for value in versions)[0]
            self.verify_private(anchor, repository_id)
            return {"status": "verified", "repository_id": repository_id, "anchor_version": anchor}
        require(
            not versions
            or (
                len(versions) == 1
                and versions[0].get("version") == BOOTSTRAP_VERSION
                and versions[0].get("repository") is None
            ),
            "Unlinked package has unknown ownership/content; source upload refused.",
        )
        existing = self.files(BOOTSTRAP_VERSION)
        if versions:
            require(existing == {BOOTSTRAP_FILE: marker}, "Unlinked bootstrap file differs; not adopted.")
        else:
            require(not existing, "Unexpected existing bootstrap files; source upload refused.")
            import io

            path = f"/api/packages/{OWNER}/generic/{PACKAGE}/{BOOTSTRAP_VERSION}/{BOOTSTRAP_FILE}"
            with io.BytesIO(BOOTSTRAP_BODY) as stream:
                self.request("PUT", path, stream=stream, size=len(BOOTSTRAP_BODY))
            require(
                self.files(BOOTSTRAP_VERSION) == {BOOTSTRAP_FILE: marker}, "Bootstrap file SHA256 was not verified."
            )
        self.request("POST", f"/api/v1/packages/{OWNER}/generic/{PACKAGE}/-/link/cageledger")
        self.verify_private(BOOTSTRAP_VERSION, repository_id)
        return {
            "status": "verified",
            "repository_id": repository_id,
            "anchor_version": BOOTSTRAP_VERSION,
            "bootstrap_marker": marker,
        }

    def files(self, version):
        version = urllib.parse.quote(version, safe="")
        path = f"/api/v1/packages/{OWNER}/generic/{PACKAGE}/{version}/files"
        body = self.request("GET", path, missing=True)
        if body is None:
            return {}
        try:
            values = json.loads(body)
            require(isinstance(values, list), "Invalid Gitea package file list.")
            files = {}
            for entry in values:
                name, size, sha256 = entry["name"], entry["size"], entry["sha256"]
                require(isinstance(name, str) and name not in files, "Invalid or duplicate Gitea package filename.")
                require(type(size) is int and size >= 0, "Invalid Gitea package file size.")
                require(
                    isinstance(sha256, str) and bool(re.fullmatch(r"[a-fA-F0-9]{64}", sha256)),
                    "Missing Gitea file SHA256.",
                )
                files[name] = {"name": name, "size": size, "sha256": sha256.lower()}
            return files
        except (ValueError, TypeError, KeyError):
            raise DeliveryError(f"Invalid Gitea package metadata: {path}") from None

    def upload(self, version, artifact):
        version = urllib.parse.quote(version, safe="")
        filename = urllib.parse.quote(artifact.path.name, safe="")
        path = f"/api/packages/{OWNER}/generic/{PACKAGE}/{version}/{filename}"
        # urllib/http.client consumes file.read() in bounded blocks; no archive-sized byte string.
        with artifact.path.open("rb") as stream:
            self.request("PUT", path, stream=stream, size=artifact.size)


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


def check_remote_file(artifact, remote):
    existing = remote.get(artifact.path.name)
    if existing is not None:
        require(
            existing == artifact.metadata(), f"Immutable remote file conflicts: {artifact.path.name}; not overwritten."
        )
        return True
    return False


def deliver(plan, client, state):
    require(not state.resolve().is_relative_to(plan.repo.resolve()), "Delivery state must be outside the repository.")
    path = state / "receipt.json"
    receipt_identity = {
        "source": plan.identity,
        "package": PACKAGE,
        "version": plan.version,
        "manifest_sha256": plan.manifest_artifact().sha256,
    }
    receipt = json.loads(path.read_text()) if path.exists() else {"identity": receipt_identity, "files": {}}
    require(receipt.get("identity") == receipt_identity, "Existing delivery receipt belongs to different artifacts.")
    receipt["status"] = "running"
    save_receipt(path, receipt)
    active = None
    try:
        receipt["privacy"] = {"status": "checking"}
        save_receipt(path, receipt)
        receipt["privacy"] = client.ensure_private()
        save_receipt(path, receipt)
        remote = client.files(plan.version)
        for artifact in plan.files():
            check_remote_file(artifact, remote)
        if plan.manifest_path.exists():
            require(
                plan.manifest_path.read_bytes() == plan.manifest,
                "Existing build manifest differs; preserve it and inspect.",
            )
        else:
            with plan.manifest_path.open("xb") as stream:
                stream.write(plan.manifest)
        for artifact in plan.files():
            active = artifact.path.name
            require(artifact.unchanged(), f"Local artifact changed: {active}")
            if check_remote_file(artifact, remote):
                receipt["files"][active] = {**artifact.metadata(), "status": "reused"}
            else:
                receipt["files"][active] = {**artifact.metadata(), "status": "uploading"}
                save_receipt(path, receipt)
                client.verify_private(receipt["privacy"]["anchor_version"], receipt["privacy"]["repository_id"])
                client.upload(plan.version, artifact)
                client.verify_private(plan.version, receipt["privacy"]["repository_id"])
                remote = client.files(plan.version)
                require(check_remote_file(artifact, remote), f"Uploaded file is not visible in Gitea: {active}")
                receipt["files"][active] = {**artifact.metadata(), "status": "verified"}
            save_receipt(path, receipt)
            print(f"{receipt['files'][active]['status']}: {active}", flush=True)
        client.verify_private(plan.version, receipt["privacy"]["repository_id"])
        receipt["status"] = "verified"
        save_receipt(path, receipt)
        return path
    except BaseException:
        receipt["status"] = "incomplete"
        if receipt.get("privacy", {}).get("status") == "checking":
            receipt["privacy"]["status"] = "unknown"
        if active and receipt["files"].get(active, {}).get("status") == "uploading":
            receipt["files"][active]["status"] = "unknown"
        save_receipt(path, receipt)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", help="Generic version; defaults to <application-version>-dev.<revision12>")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    parser.add_argument("--state-dir", type=Path, help="Receipt directory, outside the source checkout")
    parser.add_argument(
        "--dry-run", action="store_true", help="Validate local artifacts only; no network, manifest write or upload"
    )
    options = parser.parse_args()
    plan = prepare(ROOT, options.output_dir.expanduser().resolve(), options.version, check_remote=not options.dry_run)
    if options.dry_run:
        print(
            json.dumps(
                {
                    "status": "validated_locally",
                    "remote_branch_verified": False,
                    "upload_performed": False,
                    "version": plan.version,
                    "files": [a.metadata() for a in plan.files()],
                },
                indent=2,
            )
        )
        return
    state = options.state_dir or ROOT.parent / f"{ROOT.name}-delivery-state" / plan.version
    path = deliver(plan, Gitea(), state.expanduser().resolve())
    print(f"Generic Package delivery verified; receipt: {path}")
    print(f"{ORIGIN}/{OWNER}/-/packages/generic/{PACKAGE}/{urllib.parse.quote(plan.version, safe='')}")


if __name__ == "__main__":
    try:
        main()
    except (DeliveryError, OSError, ValueError, tarfile.TarError, subprocess.SubprocessError) as error:
        if isinstance(error, DeliveryError):
            raise SystemExit(str(error)) from None
        raise SystemExit("Cloud package delivery failed; inspect local artifacts and the external receipt.") from None
