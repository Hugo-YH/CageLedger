"""Read back a published release and smoke only disposable, synthetic containers.

Run with the release checkout's Python after publication. Importing this module
does not contact services or start containers. --output-dir permits a fresh
evidence directory on retries; existing evidence files are never overwritten.
"""

import argparse
import ast
import base64
import hashlib
import json
import re
import signal
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parent
REPO = Path(__file__).resolve().parent.parent
BASE = "http://ddns.cellnucle.us:3333"
IMAGE = "ddns.cellnucle.us:3333/hugo/cageledger"
GIT_REMOTE = BASE + "/hugo/cageledger.git"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def save(directory, name, data):
    target = directory / name
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("x") as output:
        json.dump(data, output, ensure_ascii=False, indent=2)
        output.write("\n")


def command(arguments, *, timeout=120):
    result = subprocess.run(arguments, cwd=REPO, text=True, capture_output=True, timeout=timeout, check=False)
    # Do not echo stderr: credential helpers and registry clients can include secrets.
    require(result.returncode == 0, f"{arguments[0]} command failed (exit {result.returncode})")
    return result.stdout.strip()


def release_identity(package, revision, expected_version, expected_build, expected_revision=None):
    require(package.get("version") == expected_version, "Checkout version differed from the intended release")
    require(str(package.get("build")) == str(expected_build), "Checkout build differed from the intended release")
    require(bool(re.fullmatch(r"[a-f0-9]{40}", revision)), "Invalid final checkout revision")
    if expected_revision:
        require(revision == expected_revision, "Checkout revision differed from the intended release")


def expected_features(repo):
    """Read only the literal feature contract; importing app services could have side effects."""
    tree = ast.parse((repo / "server_app/domains/system_features/service.py").read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "MODULES" for target in node.targets
        ):
            value = ast.literal_eval(node.value)
            require(
                isinstance(value, dict) and value and all(isinstance(key, str) for key in value),
                "Invalid system feature contract",
            )
            return set(value)
    raise RuntimeError("System feature contract was unavailable")


def parse_remote_refs(text, version, revision, branches):
    actual = {}
    for line in text.splitlines():
        parts = line.split()
        require(len(parts) == 2 and re.fullmatch(r"[a-f0-9]{40}", parts[0]), "Remote returned malformed refs")
        require(parts[1] not in actual, "Remote returned duplicate refs")
        actual[parts[1]] = parts[0]
    tag = f"refs/tags/v{version}"
    required = [f"refs/heads/{branch}" for branch in branches] + [tag, tag + "^{}"]
    require(set(actual) == set(required), "Remote refs were missing or unexpected")
    require(
        all(actual[f"refs/heads/{branch}"] == revision for branch in branches) and actual[tag + "^{}"] == revision,
        "Remote branches/peeled tag differed from final revision",
    )
    require(actual[tag] != actual[tag + "^{}"], "Release tag was not annotated")
    return actual


def verify_refs(package, revision, branches, output):
    version = package["version"]
    local_tag = command(["git", "rev-parse", f"refs/tags/v{version}^{{commit}}"])
    require(local_tag == revision, "Local release tag did not resolve to the final revision")
    refs = [f"refs/heads/{branch}" for branch in branches] + [f"refs/tags/v{version}", f"refs/tags/v{version}^{{}}"]
    actual = parse_remote_refs(command(["git", "ls-remote", GIT_REMOTE, *refs]), version, revision, branches)
    save(
        output,
        "remote-refs-verification.json",
        {
            "remote": GIT_REMOTE,
            "version": version,
            "build": package["build"],
            "revision": revision,
            "required_branches": branches,
            "refs": actual,
            "annotated_tag": True,
            "branches_and_peeled_tag_match_final_revision": True,
        },
    )
    print("Official remote branches and peeled annotated tag verified", flush=True)


class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        require(
            urllib.parse.urlsplit(new_url)[:2] == urllib.parse.urlsplit(request.full_url)[:2],
            "Refusing cross-origin authenticated redirect",
        )
        return super().redirect_request(request, response, code, message, headers, new_url)


class ReleaseHTTPError(RuntimeError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


class Client:
    def __init__(self, base, *, authorization=None):
        self.base = base
        self.authorization = authorization
        self.cookie = None
        self.opener = urllib.request.build_opener(SameOriginRedirect())

    def fetch(self, path, *, method="GET", payload=None, data=None, content_type=None, timeout=60):
        require(path.startswith("/") and not path.startswith("//"), "Expected a same-origin absolute path")
        require(not urllib.parse.urlsplit(path).path.endswith("/recognize"), "AI calls are excluded from release smoke")
        headers = {}
        if self.authorization:
            headers["Authorization"] = self.authorization
        if self.cookie:
            headers["Cookie"] = self.cookie
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode()
            content_type = "application/json"
        if content_type:
            headers["Content-Type"] = content_type
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                if method == "POST" and path == "/api/auth/login":
                    self.cookie = response.headers.get("Set-Cookie", "").split(";", 1)[0]
                    require(bool(self.cookie), "Login did not return a session cookie")
                return response.read(), response.status, response.headers.get_content_type()
        except urllib.error.HTTPError as error:
            # Keep response bodies (and any submitted facts) out of release metadata.
            raise ReleaseHTTPError(
                error.code, f"{method} {urllib.parse.urlsplit(path).path} returned HTTP {error.code}"
            ) from None

    def json(self, path, **kwargs):
        content, _, _ = self.fetch(path, **kwargs)
        return json.loads(content)


def synthetic_pdf():
    """The valid, one-page ASCII PDF fixture used by reception-certificates.spec.ts."""
    stream = "BT /F1 14 Tf 30 240 Td (Synthetic certificate CERT-E2E-001) Tj 0 -24 Td (ICR SPF Male 3) Tj ET\n"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream.encode('ascii'))} >>\nstream\n{stream}endstream",
    ]
    source = "%PDF-1.4\n"
    offsets = []
    for index, item in enumerate(objects, 1):
        offsets.append(len(source.encode("ascii")))
        source += f"{index} 0 obj\n{item}\nendobj\n"
    xref = len(source.encode("ascii"))
    source += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    source += "".join(f"{offset:010d} 00000 n \n" for offset in offsets)
    source += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return source.encode("ascii")


def multipart_pdf(content):
    boundary = "CageLedgerSyntheticRelease" + uuid4().hex
    body = (
        (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="file"; filename="synthetic-certificate.pdf"\r\n'
            "Content-Type: application/pdf\r\n\r\n"
        ).encode("ascii")
        + content
        + f"\r\n--{boundary}--\r\n".encode("ascii")
    )
    return body, f"multipart/form-data; boundary={boundary}"


def certificate_smoke(client):
    """Only writes synthetic facts into the already-verified tmpfs database."""
    identity = "release-certificate-" + uuid4().hex
    item = {
        "id": identity,
        "batchNo": identity,
        "iacuc": "Z-CERTIFICATE-UNMATCHED",
        "supplier": "合成预约供应商",
        "pi": "预约PI",
        "owner": "预约负责人",
        "roomName": "",
        "intakeDate": datetime.now(UTC).date().isoformat(),
        "quantity": 6,
        "specification": "8w",
        "finalCardCount": 0,
        "intakePurpose": "direct_sampling",
        "species": "mouse",
        "strainRaw": "ICR",
        "sex": "雄性",
        "status": "pending_receipt",
        "cards": [],
    }
    client.json("/api/intake-batches", method="POST", payload={"item": item})
    client.json("/api/intake-batches/confirm-receipt", method="POST", payload={"ids": [identity]})
    before = client.json(f"/api/intake-batches/{identity}")
    detail = client.json(f"/api/receptions/{identity}/registration")
    require(detail["batch"]["registrationStatus"] == "unconfirmed", "New synthetic registration was not unconfirmed")
    require(detail["registration"] is None and detail["runs"] == [], "Fresh synthetic batch had certificate facts")
    version = detail["batch"]["updatedAt"]
    content = synthetic_pdf()
    upload, content_type = multipart_pdf(content)
    attachment = client.json(
        f"/api/receptions/{identity}/certificates?" + urllib.parse.urlencode({"expectedBatchUpdatedAt": version}),
        method="POST",
        data=upload,
        content_type=content_type,
        timeout=120,
    )["attachment"]
    digest = hashlib.sha256(content).hexdigest()
    require(attachment["pageCount"] == 1, "Real Poppler upload did not identify one PDF page")
    require(attachment["sha256"] == digest and attachment["size"] == len(content), "Uploaded PDF metadata differed")
    original, original_status, original_type = client.fetch(attachment["fileUrl"])
    require(original_status == 200 and original_type == "application/pdf", "Original PDF download failed")
    require(original == content and hashlib.sha256(original).hexdigest() == digest, "Downloaded PDF bytes differed")
    preview, preview_status, preview_type = client.fetch(attachment["previewUrl"])
    require(preview_status == 200 and preview_type == "image/png", "Real Poppler preview download failed")
    require(preview.startswith(b"\x89PNG\r\n\x1a\n") and preview[12:16] == b"IHDR", "Preview was not a PNG")
    width, height = int.from_bytes(preview[16:20], "big"), int.from_bytes(preview[20:24], "big")
    require(0 < width <= 3000 and 0 < height <= 3000, "Preview PNG dimensions were invalid")
    detail = client.json(f"/api/receptions/{identity}/registration")
    require(detail["batch"]["updatedAt"] == version, "Upload changed the source batch version")
    line = {
        "id": uuid4().hex,
        "attachmentId": attachment["id"],
        "runId": None,
        "certificateIndex": 1,
        "certificateLineIndex": 1,
        "certificateNo": "CERT-E2E-001",
        "certificateStrain": "ICR",
        "grade": "SPF",
        "supplier": "合成出售单位",
        "sex": "雄性",
        "quantity": 3,
        "weightRaw": "",
        "ageRaw": "",
        "specification": "6-8w",
        "receiptId": None,
        "experimentCertificateNo": "",
        "notes": "Synthetic release smoke only",
    }
    saved = client.json(
        f"/api/receptions/{identity}/registration",
        method="PUT",
        payload={
            "requestId": uuid4().hex,
            "expectedBatchUpdatedAt": detail["batch"]["updatedAt"],
            "expectedRegistrationUpdatedAt": None,
            "expectedApplicationVersion": detail["applicationVersion"],
            "acknowledged": True,
            "lines": [line],
        },
    )["registration"]
    detail = client.json(f"/api/receptions/{identity}/registration")
    require(detail["registration"] == saved and detail["runs"] == [], "Manual registration or no-AI invariant failed")
    require(saved["lines"][0]["runId"] is None and saved["totalQuantity"] == 3, "Manual facts were not retained")
    document = client.json(
        "/api/receptions/preview",
        method="POST",
        payload={
            "ids": [identity],
            "expectedVersions": {identity: detail["batch"]["updatedAt"]},
            "expectedApplicationVersion": detail["applicationVersion"],
            "expectedRegistrationVersions": {identity: saved["updatedAt"]},
        },
    )
    require(document["rowCount"] == 1 and len(document["rows"]) == 1, "Confirmed preview row count differed")
    row = document["rows"][0]
    require(
        row["quantity"] == 3
        and row["quantitySource"] == "certificate_confirmed"
        and row["qualityCertificateNo"] == "CERT-E2E-001",
        "Preview did not use confirmed certificate facts",
    )
    require(client.json(f"/api/intake-batches/{identity}") == before, "Certificate flow modified the source batch")
    summary = client.json("/api/receptions?limit=10&offset=0")
    require(summary["page"]["total"] == 1 and len(summary["items"]) == 1, "Synthetic reception summary count differed")
    summary_item = summary["items"][0]
    require(
        summary_item["id"] == identity
        and summary_item["registrationStatus"] == "confirmed"
        and summary_item["registeredQuantity"] == 3
        and summary_item["certificateCount"] == 1,
        "Reception summary did not expose confirmed quantities and certificate count",
    )
    return {
        "synthetic_only": True,
        "page_count": 1,
        "pdf_bytes": len(content),
        "pdf_sha256": digest,
        "original_bytes_equal": True,
        "original_sha256_equal": True,
        "real_poppler_png": True,
        "png_bytes": len(preview),
        "png_dimensions": [width, height],
        "manual_registration_confirmed": True,
        "versioned_preview_passed": True,
        "reception_summary_passed": True,
        "source_batch_unchanged": True,
        "ai_calls": 0,
    }


def manifest_platforms(manifest):
    platforms = {}
    for entry in manifest.get("manifests", []):
        platform = entry.get("platform", {})
        architecture = platform.get("architecture")
        if platform.get("os") == "linux" and architecture in {"arm64", "amd64"}:
            digest = entry.get("digest", "")
            require(bool(re.fullmatch(r"sha256:[a-f0-9]{64}", digest)), "Manifest platform digest was invalid")
            require(architecture not in platforms, "Manifest contained duplicate release architectures")
            platforms[architecture] = digest
    require(set(platforms) == {"arm64", "amd64"}, "Release manifest must contain Linux arm64 and amd64")
    return platforms


def container_smoke(architecture, digest, package, revision, output, features_expected):
    name = f"cageledger-release-{package['version'].replace('.', '')}-{architecture}-{uuid4().hex[:12]}"
    report = {
        "architecture": architecture,
        "image": f"{IMAGE}@{digest}",
        "status": "failed",
        "owned_container_name": name,
    }
    cleanup_ok = False
    try:
        container_id = command(
            [
                "docker",
                "run",
                "--pull=always",
                "-d",
                "--rm",
                "--name",
                name,
                "--label",
                "cageledger.release-verifier=synthetic-only",
                "--platform",
                f"linux/{architecture}",
                "--cpus",
                "1",
                "--memory",
                "768m",
                "--tmpfs",
                "/app/data:rw,nosuid,nodev,size=256m",
                "-p",
                "127.0.0.1::5173",
                "-e",
                "CAGELEDGER_DATA_ROOT=/app/data",
                "-e",
                "CAGELEDGER_DB=/app/data/cageledger.sqlite",
                "-e",
                "CAGELEDGER_ADMIN_PASSWORD=release-smoke-only",
                "-e",
                "CAGELEDGER_IACUC_AUTO_IMPORT_ENABLED=0",
                "-e",
                "CAGELEDGER_UPDATE_CHECK_ENABLED=false",
                "-e",
                "DEEPSEEK_API_KEY=",
                f"{IMAGE}@{digest}",
            ],
            timeout=900,
        )
        require(bool(re.fullmatch(r"[a-f0-9]{64}", container_id)), "Docker did not return a container ID")
        address = command(["docker", "port", name, "5173/tcp"])
        require(bool(re.fullmatch(r"127\.0\.0\.1:\d+", address)), "Smoke port was not bound only to loopback")
        client = Client("http://" + address)
        deadline = time.monotonic() + 180
        while True:
            try:
                health = client.json("/api/health", timeout=3)
                break
            except (OSError, RuntimeError):
                require(time.monotonic() < deadline, f"{architecture} disposable container health timeout")
                time.sleep(1)
        require(
            health.get("ok") is True and health.get("database") == "/app/data/cageledger.sqlite",
            "Health did not identify the fresh tmpfs database",
        )
        system = health["system"]
        require(
            system["version"] == package["version"]
            and str(system["build"]) == str(package["build"])
            and system["revision"] == revision,
            "Container version/build/final revision differed",
        )
        docs, status, _ = client.fetch("/docs/")
        require(status == 200 and b"CageLedger" in docs, "Built documentation was unavailable")
        client.json("/api/auth/login", method="POST", payload={"username": "admin", "password": "release-smoke-only"})
        require(client.json("/api/intake-batches?limit=10&offset=0")["items"] == [], "Fresh intake list was not empty")
        summary = client.json("/api/receptions?limit=10&offset=0")
        require(
            summary["items"] == [] and summary["page"]["total"] == 0 and isinstance(summary["applicationVersion"], str),
            "Fresh reception summary was invalid",
        )
        require(
            isinstance(client.json("/api/iacuc-index?query=Z2099000&limit=10")["items"], list),
            "IACUC index endpoint was unavailable",
        )
        features = client.json("/api/system/features")["item"]["enabled"]
        require(
            set(features) == features_expected and all(value is True for value in features.values()),
            "Fresh system feature defaults differed",
        )
        report.update(
            health={
                "ok": True,
                "database": health["database"],
                "system": {key: system[key] for key in ("version", "build", "revision")},
            },
            docs_http_status=status,
            fresh_intake_and_receptions_empty=True,
            iacuc_search_available=True,
            system_feature_defaults=features,
            certificate=certificate_smoke(client),
            status="passed",
        )
    except BaseException as error:
        report["error_type"] = type(error).__name__
        raise
    finally:
        # This unique, verifier-owned name is never shared with application services.
        # Attempt cleanup even if docker run timed out after creating the container.
        try:
            stopped = subprocess.run(["docker", "stop", "-t", "3", name], capture_output=True, timeout=20, check=False)
            cleanup_ok = stopped.returncode == 0
            if not cleanup_ok:
                removed = subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=20, check=False)
                cleanup_ok = removed.returncode == 0
            if not cleanup_ok:
                remaining = subprocess.run(
                    ["docker", "ps", "-a", "--filter", f"name=^/{name}$", "--format", "{{.ID}}"],
                    capture_output=True,
                    text=True,
                    timeout=20,
                    check=False,
                )
                cleanup_ok = remaining.returncode == 0 and not remaining.stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            cleanup_ok = False
        report["owned_container_stopped"] = cleanup_ok
        save(output, f"{architecture}/container-smoke.json", report)
    require(cleanup_ok, f"Could not stop the owned {architecture} smoke container")
    print(f"{architecture}: health, docs, feature defaults and real-Poppler certificate smoke passed", flush=True)
    return report


def gitea_authorization():
    from release_credentials import gitea_credentials

    return gitea_credentials(REPO)


def verify_remote(package, revision, output):
    version = package["version"]
    expected_dir = output / "expected-release-notes"
    expected_dir.mkdir(parents=True, exist_ok=False)
    command(["node", "scripts/release_notes_payload.mjs", "--version", version, "--output-dir", str(expected_dir)])
    expected = json.loads((expected_dir / "release-create.json").read_text())
    client = Client(BASE, authorization=gitea_authorization())
    release = client.json(f"/api/v1/repos/hugo/cageledger/releases/tags/v{version}")
    require(
        release["tag_name"] == f"v{version}"
        and release["draft"] is False
        and release["prerelease"] == expected.get("prerelease", False),
        "Remote release was not the final published tag",
    )
    published = datetime.fromisoformat(release["published_at"].replace("Z", "+00:00"))
    require(published > datetime(1970, 1, 2, tzinfo=UTC), "Release publication timestamp was an epoch placeholder")
    require(
        release.get("body", "").replace("\r\n", "\n").strip() == expected["body"].strip(),
        "Remote release body differed from the generated authoritative notes",
    )
    archive = REPO / "dist" / f"CageLedger-offline-{version}.tar.gz"
    with archive.open("rb") as source:
        local_hash = hashlib.file_digest(source, "sha256").hexdigest()
    assets = [asset for asset in release["assets"] if asset["name"] == archive.name]
    require(len(assets) == 1, "Release did not contain exactly one matching offline archive")
    url = urllib.parse.urlsplit(assets[0]["browser_download_url"])
    require(url[:2] == urllib.parse.urlsplit(BASE)[:2], "Release asset URL was outside official Gitea")
    # Stream the archive without persisting a second copy or exposing credentials.
    request = urllib.request.Request(urllib.parse.urlunsplit(url), headers={"Authorization": client.authorization})
    with client.opener.open(request, timeout=120) as response:
        remote_hash = hashlib.file_digest(response, "sha256").hexdigest()
    require(local_hash == remote_hash, "Release asset SHA256 differed from the local offline archive")
    save(
        output,
        "release-remote-verification.json",
        {
            "tag": release["tag_name"],
            "version": version,
            "build": package["build"],
            "revision": revision,
            "published_at": release["published_at"],
            "draft": False,
            "prerelease": False,
            "body_matches_generated_notes": True,
            "body_sha256": hashlib.sha256(expected["body"].encode()).hexdigest(),
            "asset_name": archive.name,
            "bytes": archive.stat().st_size,
            "sha256": remote_hash,
            "url": f"{BASE}/hugo/cageledger/releases/tag/v{version}",
        },
    )
    wiki = client.json("/api/v1/repos/hugo/cageledger/wiki/page/Home")
    content = base64.b64decode(wiki["content_base64"], validate=True).decode()
    require("/docs" in content and "CageLedger" in content, "Wiki Home did not link the hosted documentation")
    save(
        output,
        "wiki-verification.json",
        {
            "verified": True,
            "page": "Home",
            "hosted_docs_link": True,
            "content_sha256": hashlib.sha256(content.encode()).hexdigest(),
            "url": f"{BASE}/hugo/cageledger/wiki/Home",
        },
    )
    print("Published Release body, offline asset SHA256 and Wiki Home verified", flush=True)


def interrupted(_signal, _frame):
    raise KeyboardInterrupt("Release verification interrupted")


def main():
    global REPO
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, interrupted)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT)
    parser.add_argument("--repo-dir", type=Path, default=REPO)
    parser.add_argument("--expected-version", required=True)
    parser.add_argument("--expected-build", type=int, required=True)
    parser.add_argument("--expected-revision")
    parser.add_argument(
        "--required-branch",
        action="append",
        choices=("main", "beta", "rc"),
        help="Repeat for each branch required at the final revision; defaults to main and beta",
    )
    parser.add_argument("--stage", choices=("all", "remote", "containers"), default="all")
    options = parser.parse_args()
    REPO = options.repo_dir.resolve()
    output = options.output_dir.resolve()
    require(not output.is_relative_to(REPO.resolve()), "Evidence must be written outside the release checkout")
    output.mkdir(parents=True, exist_ok=True)
    package = json.loads((REPO / "package.json").read_text())
    revision = command(["git", "rev-parse", "HEAD"])
    release_identity(package, revision, options.expected_version, options.expected_build, options.expected_revision)
    require(
        command(["git", "status", "--porcelain", "--untracked-files=no"]) == "",
        "Release checkout had tracked uncommitted changes",
    )
    if options.stage in {"all", "remote"}:
        verify_refs(package, revision, options.required_branch or ["main", "beta"], output)
        verify_remote(package, revision, output)
    if options.stage in {"all", "containers"}:
        features_expected = expected_features(REPO)
        manifest = json.loads(
            command(["docker", "buildx", "imagetools", "inspect", "--raw", f"{IMAGE}:{package['version']}"])
        )
        platforms = manifest_platforms(manifest)
        save(
            output,
            "oci-manifest-verification.json",
            {
                "image": f"{IMAGE}:{package['version']}",
                "version": package["version"],
                "build": package["build"],
                "revision": revision,
                "platforms": {f"linux/{key}": value for key, value in platforms.items()},
            },
        )
        for architecture in ("arm64", "amd64"):
            container_smoke(architecture, platforms[architecture], package, revision, output, features_expected)
    print("Release artifacts verified; production deployment was not performed", flush=True)


if __name__ == "__main__":
    main()
