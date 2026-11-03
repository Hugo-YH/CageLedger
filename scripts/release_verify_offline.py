"""Verify archive contents, then run API smoke against a separate fresh runtime.

Requires CAGELEDGER_PYTHON_BIN (the parent-selected .venv Python). Importing this
module does not extract archives or start a server. Existing evidence is retained;
use --output-dir with a fresh directory for a repeated verification.
"""

import argparse
import hashlib
import json
import os
import re
import signal
import socket
import subprocess
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent
REPO = Path(__file__).resolve().parent.parent


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def save(directory, name, data):
    with (directory / name).open("x") as output:
        json.dump(data, output, ensure_ascii=False, indent=2)
        output.write("\n")


def validate_public_env_template(archived, source, *, tracked, committed):
    """Allow only unchanged public template bytes; never include file content in errors."""
    require(tracked, "Public environment example was not tracked by Git")
    require(archived == source, "Archived public environment example differed from its source")
    require(source == committed, "Public environment example differed from the release commit")
    require(
        not re.search(rb"-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----", source)
        and not re.search(rb"\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b", source),
        "Public environment example contained a credential-shaped value",
    )


def public_env_template_check(bundle, member, repo):
    source = repo / ".env.example"
    require(
        member.name == f"{repo.name}/.env.example" and member.isfile() and source.is_file() and not source.is_symlink(),
        "Unauthorized environment example path or file type",
    )
    tracked = (
        subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", ".env.example"],
            cwd=repo,
            capture_output=True,
            timeout=10,
            check=False,
        ).returncode
        == 0
    )
    require(tracked, "Public environment example was not tracked by Git")
    committed = subprocess.run(
        ["git", "show", "HEAD:.env.example"], cwd=repo, capture_output=True, timeout=10, check=False
    )
    require(committed.returncode == 0, "Release commit did not contain the public environment example")
    with bundle.extractfile(member) as archived:
        validate_public_env_template(archived.read(), source.read_bytes(), tracked=tracked, committed=committed.stdout)


def archive_check(bundle, repo):
    members = bundle.getmembers()
    names = {member.name for member in members}
    require(len(members) == len(names), "Offline archive contained duplicate paths")
    forbidden = {
        ".git",
        ".gitea",
        ".github",
        ".codex",
        ".codex-run",
        ".env",
        ".venv",
        "node_modules",
        "node_modules 2",
        "data",
        "dist",
        ".ruff_cache",
        "__pycache__",
        "test-results",
        "playwright-report",
        "软件著作权申请资料",
    }
    for member in members:
        path = PurePosixPath(member.name)
        require(
            not path.is_absolute() and ".." not in path.parts and path.parts[0] == repo.name,
            "Archive entry escaped the application root",
        )
        require(not forbidden.intersection(path.parts), f"Forbidden archive entry: {member.name}")
        if path.name.startswith(".env."):
            public_env_template_check(bundle, member, repo)
        require(
            path.name not in {"data.zip", ".DS_Store", "iacuc-data.local.json"}, "Archive contained local data files"
        )
        require(not re.search(r"\.sqlite(?:3)?(?:-|$)", path.name), "Archive contained SQLite runtime data")
        relative = path.parts[1:]
        require(
            not relative or relative[0] not in {"docs", ".vitepress", "tests"}, "Archive contained development paths"
        )
        require(tuple(relative[:3]) != ("wiki", ".vitepress", "cache"), "Archive contained documentation cache")
        require(
            member.isdir() or member.isfile() or member.issym() or member.islnk(), "Archive contained a special file"
        )
    built_files = sorted(path for path in (repo / "web-dist").rglob("*") if path.is_file())
    require(bool(built_files), "No local built application files were found")
    for path in built_files:
        name = repo.name + "/" + path.relative_to(repo).as_posix()
        require(name in names, f"Archive omitted built file: {name}")
        member = bundle.getmember(name)
        require(member.isfile(), f"Built file was not a regular archive member: {name}")
        with bundle.extractfile(member) as archived, path.open("rb") as local:
            require(
                hashlib.file_digest(archived, "sha256").digest() == hashlib.file_digest(local, "sha256").digest(),
                f"Archive built-file content differed: {name}",
            )
    require(
        f"{repo.name}/web-dist/index.html" in names and f"{repo.name}/web-dist/docs/index.html" in names,
        "Archive omitted the application or built documentation entry",
    )
    return {
        "archive_entries": len(names),
        "all_built_files_verified": len(built_files),
        "development_docs_excluded": True,
        "sensitive_and_runtime_paths_excluded": True,
        "public_env_example_verified": f"{repo.name}/.env.example" in names,
    }


def expected_smoke_checks(app):
    source = (app / "scripts/smoke_api.mjs").read_text()
    checks = re.search(r"const checks = \[(.*?)\];", source, re.DOTALL)
    baseline = re.search(r"checks:\s*checks\.length\s*\+\s*(\d+)", source)
    require(checks and baseline, "Unable to derive the API smoke check count from its source")
    endpoints = re.findall(r'"(/api/[^"\n]+)"', checks.group(1))
    require(endpoints and len(endpoints) == len(set(endpoints)), "Invalid API smoke endpoint catalog")
    return len(endpoints) + int(baseline.group(1))


def fresh_environment(runtime, port):
    # Inherited CAGELEDGER paths must never redirect an isolated smoke to user data.
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("CAGELEDGER_", "DEEPSEEK_"))
        and key not in {"PYTHONPATH", "PYTHONHOME", "PYTHONPYCACHEPREFIX"}
    }
    environment.update(
        {
            "CAGELEDGER_HOST": "127.0.0.1",
            "CAGELEDGER_PORT": str(port),
            "CAGELEDGER_DATA_ROOT": str(runtime),
            "CAGELEDGER_DB": str(runtime / "database.sqlite"),
            "CAGELEDGER_ADMIN_PASSWORD": "offline-check-created",
            "CAGELEDGER_IACUC_AUTO_IMPORT_ENABLED": "0",
            "CAGELEDGER_UPDATE_CHECK_ENABLED": "false",
            "DEEPSEEK_API_KEY": "",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )
    return environment


def runtime_smoke(bundle, python, package, output):
    with tempfile.TemporaryDirectory(prefix="cageledger-offline-verify-") as temporary_directory:
        temporary = Path(temporary_directory)
        bundle.extractall(temporary, filter="data")
        app = temporary / REPO.name
        runtime = temporary / "fresh-runtime"
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        environment = fresh_environment(runtime, port)
        with (output / "offline-server.log").open("x") as log:
            process = subprocess.Popen(
                [str(python), "server.py"],
                cwd=app,
                env=environment,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            base = f"http://127.0.0.1:{port}"
            try:
                deadline = time.monotonic() + 60
                while True:
                    require(process.poll() is None, "Fresh offline server exited before health was ready")
                    try:
                        with urllib.request.urlopen(base + "/api/health", timeout=2) as response:
                            health = json.load(response)
                        break
                    except OSError:
                        require(time.monotonic() < deadline, "Fresh offline server health timeout")
                        time.sleep(0.2)
                # This identity check precedes login and the API smoke script.
                require(
                    health.get("ok") is True and health.get("database") == str(runtime / "database.sqlite"),
                    "Offline health did not identify the temporary runtime database",
                )
                require(
                    health["system"]["version"] == package["version"]
                    and str(health["system"]["build"]) == str(package["build"]),
                    "Offline runtime version/build differed from package.json",
                )
                with urllib.request.urlopen(base + "/docs/", timeout=20) as response:
                    docs = response.read().decode()
                    require(
                        response.status == 200 and "CageLedger" in docs, "Built offline documentation was unavailable"
                    )
                assets = re.findall(r'(?:src|href)="(/docs/assets/[^\"]+\.js)"', docs)
                require(bool(assets), "Built documentation did not reference JavaScript assets")
                with urllib.request.urlopen(base + assets[0], timeout=20) as response:
                    require(response.status == 200 and len(response.read()) > 100, "Offline docs JS was unavailable")
                result = subprocess.run(
                    ["node", str(app / "scripts/smoke_api.mjs")],
                    cwd=app,
                    env={
                        **environment,
                        "CAGELEDGER_SMOKE_BASE_URL": base,
                        "CAGELEDGER_SMOKE_PASSWORD": "offline-check-created",
                    },
                    text=True,
                    capture_output=True,
                    timeout=120,
                    check=False,
                )
                require(
                    result.returncode == 0, "Fresh offline API smoke script failed; inspect the isolated server log"
                )
                smoke = json.loads(result.stdout)
                require(
                    smoke.get("ok") is True
                    and smoke.get("version") == package["version"]
                    and smoke.get("checks") == expected_smoke_checks(app),
                    "Fresh offline API smoke returned incomplete results",
                )
                save(output, "offline-smoke-api.json", smoke)
                return {
                    "built_docs_and_js_served": True,
                    "offline_api_smoke_checks": smoke["checks"],
                    "fresh_runtime_only": True,
                    "database_identity_verified_before_login": True,
                    "runtime_revision": health["system"].get("revision"),
                    "runtime_revision_note": "Archive excludes Git metadata; version and build are package-derived",
                }
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=10)


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
    options = parser.parse_args()
    REPO = options.repo_dir.resolve()
    output = options.output_dir.resolve()
    require(not output.is_relative_to(REPO.resolve()), "Evidence must be written outside the release checkout")
    output.mkdir(parents=True, exist_ok=True)
    python_value = os.environ.get("CAGELEDGER_PYTHON_BIN", "")
    require(bool(python_value), "Parent must provide CAGELEDGER_PYTHON_BIN using the project .venv")
    python = Path(python_value).absolute()
    require(python.is_file() and ".venv" in python.parts, "Offline smoke requires the parent-selected .venv Python")
    package = json.loads((REPO / "package.json").read_text())
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True, timeout=10).strip()
    require(
        package.get("version") == options.expected_version and str(package.get("build")) == str(options.expected_build),
        "Offline source version/build differed from intended release",
    )
    require(bool(re.fullmatch(r"[a-f0-9]{40}", revision)), "Invalid offline source revision")
    if options.expected_revision:
        require(revision == options.expected_revision, "Offline source revision differed from intended release")
    archive = REPO / "dist" / f"CageLedger-offline-{package['version']}.tar.gz"
    with archive.open("rb") as source:
        sha256 = hashlib.file_digest(source, "sha256").hexdigest()
    with tarfile.open(archive) as bundle:
        contents = archive_check(bundle, REPO)
        runtime = runtime_smoke(bundle, python, package, output)
    report = {
        "file": archive.name,
        "sha256": sha256,
        "bytes": archive.stat().st_size,
        "version": package["version"],
        "build": package["build"],
        "source_revision": revision,
        **contents,
        **runtime,
    }
    save(output, "offline-package-verification.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
