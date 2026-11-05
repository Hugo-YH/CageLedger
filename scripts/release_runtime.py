"""Evidence, process ownership and strict remote-state primitives for local releases. No action occurs on import; --dry-run is read-only.

A completed receipt is reusable only for identical inputs and intact outputs.
Interrupted mutations are reconciled, never blindly retried. Evidence is local,
not a signature or a substitute for a trusted checkout/host.
"""

import copy
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from contextlib import contextmanager
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

from release_endpoints import DEFAULT_GITEA_URL, HTTPS_GITEA_URL, REPOSITORY_PATH, gitea_url
from release_reporting import progress
from validation_inputs import metadata

ROOT = Path(__file__).resolve().parent.parent
RELEASE_FILES = {
    "package.json",
    "src/react/version.ts",
    "src/react/releaseNotesDocs.ts",
    "src/react/releaseNotesVersions.ts",
    "wiki/更新日志.md",
}


def require(value, message):
    if not value:
        raise RuntimeError(message)


@lru_cache(maxsize=32768)
def cached_file_digest(path, identity):
    # ctime/mtime/inode/size/mode guard the in-process cache; each invocation starts empty.
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def digest(path):
    path = Path(path)
    if path.is_symlink():
        return hashlib.sha256(os.readlink(path).encode()).hexdigest()
    stat = path.stat()
    identity = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_mode)
    return cached_file_digest(str(path.resolve()), identity)


def hashed(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def tree(path):
    path = Path(path)
    require(path.exists(), f"Missing artifact: {path}")
    if path.is_file():
        return {".": digest(path)}
    return {str(p.relative_to(path)): digest(p) for p in sorted(path.rglob("*")) if p.is_file() or p.is_symlink()}


_TOOL_VALIDATIONS = {}
_TOOL_VALIDATION_LOCK = threading.RLock()


def clear_tool_validation_cache():
    """Drop this process's trusted installation proofs, including byte-digest memoization."""
    with _TOOL_VALIDATION_LOCK:
        _TOOL_VALIDATIONS.clear()
        cached_file_digest.cache_clear()


def cached_tool_validation(kind, path, validate, *, required=(), context=()):
    """Only installed tools use this cache; source, output and remote checks stay independent."""
    with _TOOL_VALIDATION_LOCK:
        try:
            actual = Path(path).expanduser().resolve(strict=True)
            for item in required:
                require(Path(item).resolve(strict=True).is_file(), "Required tool executable is not a file")
            signature = metadata(actual)
        except (OSError, RuntimeError):
            # Missing mocked locations must not seed a success cache for a later real installation.
            return copy.deepcopy(validate())
        if signature == "missing":
            return copy.deepcopy(validate())
        key = (kind, str(actual), tuple(context))
        entry = _TOOL_VALIDATIONS.get(key)
        if entry is not None and entry[0] == signature:
            return copy.deepcopy(entry[1])
        value = validate()
        require(metadata(actual) == signature, "Tool installation changed during validation")
        _TOOL_VALIDATIONS[key] = (signature, copy.deepcopy(value))
        return copy.deepcopy(value)


def tool_tree(path):
    """Reuse complete browser bundle bytes only while its full installation metadata is unchanged."""
    return cached_tool_validation("browser-tree", path, lambda: tree(path))


def command(args, cwd=ROOT, *, env=None, timeout=120):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout, check=False)
    require(result.returncode == 0, f"{args[0]} failed (exit {result.returncode}); inspect the phase log")
    return result.stdout.strip()


def source_fingerprint(repo):
    names = command(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], repo).split("\0")
    return hashed(
        {name: digest(repo / name) if (repo / name).exists() else "missing" for name in sorted(set(names)) if name}
    )


def converter_executable(required=True):
    configured = os.environ.get("CAGELEDGER_LIBREOFFICE_BIN", "").strip()
    candidate = configured or shutil.which("soffice") or shutil.which("libreoffice")
    if not candidate and not required:
        return None
    require(bool(candidate), "LibreOffice required; configure CAGELEDGER_LIBREOFFICE_BIN before release")
    path = Path(candidate).expanduser().resolve(strict=True)
    require(path.is_file() and os.access(path, os.X_OK), "LibreOffice executable unavailable")
    return path


def converter_identity():
    path = converter_executable()
    # Managed release admission currently supports macOS only. Hash the entire
    # signed bundle: Writer depends on libraries, filters, fonts and resources.
    require(sys.platform == "darwin", "Unsupported release converter platform")
    bundle = next((parent for parent in path.parents if parent.suffix == ".app"), None)
    require(bundle is not None, "Release converter must belong to a verified macOS application bundle")

    def verify():
        command(["codesign", "--verify", "--deep", "--strict", str(bundle)])
        command(["spctl", "--assess", "--type", "execute", str(bundle)])
        with tempfile.TemporaryDirectory(prefix="cageledger-release-converter-") as temporary:
            version = command(
                [str(path), "-env:UserInstallation=" + Path(temporary).as_uri(), "--version"],
                timeout=30,
            )
        require(
            bool(re.fullmatch(r"LibreOffice [0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)? [0-9a-f]+", version)),
            "Unrecognized LibreOffice version response",
        )
        return {
            "executable": str(path),
            "bundle": str(bundle),
            "bundle_sha256": hashed(tree(bundle)),
            "version": version,
        }

    return cached_tool_validation("converter", bundle, verify, required=(path,), context=(str(path),))


def browser_installations(repo):
    # Resolve exactly the locked Playwright executables, including the headless
    # shell actually used by tests and ffmpeg used by traces/video. Do not hash
    # unrelated historical installations or overlook a missing headless shell.
    script = """
const {registry} = require('playwright-core/lib/coreBundle').registry;
console.log(JSON.stringify(['chromium','chromium-headless-shell','firefox','webkit','ffmpeg'].map(name => {
  const item = registry.findExecutable(name);
  return {name, executable: item.executablePathOrDie('javascript'), directory: item.directory};
})));
"""
    paths = json.loads(command(["node", "-e", script], repo, env=isolation_environment()))
    require(len(paths) == 5, "Incomplete locked Playwright runtime")
    for item in paths:
        require(Path(item["executable"]).is_file() and os.access(item["executable"], os.X_OK), "Browser unavailable")
    return sorted({Path(item["directory"]) for item in paths})


def runtime_fingerprint(repo):
    # Hash browser bundles, not merely a version string or executable pathname.
    browsers = {str(p): tool_tree(p) for p in browser_installations(repo)}
    return hashed(
        {
            "python": digest(Path(sys.executable).resolve()),
            "python_version": sys.version,
            "node": command(["node", "--version"], repo),
            "node_binary": digest(command(["node", "-p", "process.execPath"], repo)),
            "platform": command(["uname", "-a"], repo),
            "browsers": browsers,
            "pdf_chromium": os.environ.get("CAGELEDGER_RELEASE_PDF_CHROMIUM"),
            "converter": converter_identity(),
            "npm_install": tree(repo / "node_modules/.package-lock.json"),
            "environment": {k: os.environ.get(k, "") for k in ("TZ", "LANG", "LC_ALL")},
            "python_install": command([sys.executable, "-m", "pip", "freeze", "--all"], repo),
        }
    )


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    with temporary.open("x") as output:
        json.dump(value, output, indent=2, ensure_ascii=False)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


@contextmanager
def release_lock(repo):
    common = Path(command(["git", "rev-parse", "--git-common-dir"], repo))
    if not common.is_absolute():
        common = repo / common
    with (common / "cageledger-release.lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Another managed release holds this repository lock") from error
        yield


class Journal:
    def __init__(self, directory, identity):
        self.directory = Path(directory)
        self.path = self.directory / "state.json"
        self.mutex = threading.RLock()
        if self.path.exists():
            self.data = json.loads(self.path.read_text())
            require(self.data.get("identity") == identity, "State belongs to another checkout/version")
        else:
            self.data = {"schema": 1, "identity": identity, "stages": {}, "history": []}
        self.save()

    def save(self):
        with self.mutex:
            atomic_json(self.path, self.data)

    def reusable(self, name, fingerprint):
        entry = self.data["stages"].get(name, {})
        if entry.get("status") != "passed" or entry.get("fingerprint") != fingerprint:
            return False
        try:
            return bool(entry.get("outputs")) and all(tree(path) == value for path, value in entry["outputs"].items())
        except (OSError, RuntimeError):
            return False

    def begin(self, name, fingerprint, mutation=False):
        with self.mutex:
            previous = self.data["stages"].get(name)
            if previous:
                self.data["history"].append({"name": name, **previous})
            entry = {
                "status": "running",
                "fingerprint": fingerprint,
                "mutation": mutation,
                "started": datetime.now(UTC).isoformat(),
                "attempt": uuid4().hex,
            }
            self.data["stages"][name] = entry
            self.save()
            print(
                f"[release] 开始 {name} · 日志 {self.directory / name / entry['attempt'] / 'command.log'}", flush=True
            )
            return self.directory / name / entry["attempt"]

    def end(self, name, status, outputs=(), **details):
        with self.mutex:
            started = datetime.fromisoformat(self.data["stages"][name]["started"])
            details["elapsed_seconds"] = (datetime.now(UTC) - started).total_seconds()
            self.data["stages"][name].update(
                status=status,
                ended=datetime.now(UTC).isoformat(),
                outputs={str(p): tree(p) for p in outputs},
                **details,
            )
            self.save()
            print(f"[release] {name}: {status} · {details['elapsed_seconds']:.1f}s", flush=True)


def specs(suites):
    for suite in suites:
        yield from suite.get("specs", [])
        yield from specs(suite.get("suites", []))


def cases(report, engine, executed):
    require(not report.get("errors"), "Browser report contains top-level errors")
    config = report["config"]
    require(config["workers"] == 1 and config["fullyParallel"] is False, "Unsafe browser concurrency")
    projects = config["projects"]
    require(len(projects) == 1 and projects[0]["name"] == engine, "Wrong browser project")
    require(projects[0]["retries"] == 0 and projects[0]["repeatEach"] == 1, "Retry/repeat configured")
    found = []
    for spec in specs(report["suites"]):
        for test in spec["tests"]:
            require(test["projectName"] == engine and test["expectedStatus"] == "passed", "Unexpected test contract")
            found.append((spec["id"], engine))
            if executed:
                results = test["results"]
                require(spec["ok"] and test["status"] == "expected" and len(results) == 1, "Failed/skipped/flaky case")
                require(
                    results[0]["status"] == "passed"
                    and results[0]["retry"] == 0
                    and not results[0].get("error")
                    and not results[0].get("errors"),
                    "Non-passing result",
                )
    require(found and len(found) == len(set(found)), "Empty or duplicate browser cases")
    if executed:
        stats = report["stats"]
        require(
            all(stats[k] == 0 for k in ("unexpected", "flaky", "skipped")) and stats["expected"] == len(found),
            "Incomplete report statistics",
        )
    return found


def isolation_environment():
    converter = converter_executable(required=False)
    pdf_browser = os.environ.get("CAGELEDGER_RELEASE_PDF_CHROMIUM")
    env = dict(os.environ)
    # Do not allow inherited application configuration to select production data/services.
    for key in list(env):
        if (
            key.startswith(("CAGELEDGER_", "PLAYWRIGHT_", "DEEPSEEK_"))
            or key.endswith("_API_KEY")
            or key in {"DATABASE_URL", "CI", "PYTHONPATH", "PYTHONHOME", "PYTHONPYCACHEPREFIX"}
        ):
            env.pop(key)
    env.update(
        CAGELEDGER_PYTHON_BIN=sys.executable,
        CAGELEDGER_EPHEMERAL_DB="1",
        CAGELEDGER_E2E_REUSE="0",
        CAGELEDGER_E2E_DEEPSEEK_API_KEY="",
        CAGELEDGER_E2E_GITEA_TOKEN="",
        DEEPSEEK_API_KEY="",
        NODE_OPTIONS="--max-old-space-size=3072",
    )
    if converter is not None:
        env["CAGELEDGER_LIBREOFFICE_BIN"] = str(converter)
    if pdf_browser:
        env["CAGELEDGER_CHROMIUM_BIN"] = pdf_browser
        env["CAGELEDGER_RELEASE_PDF_CHROMIUM"] = pdf_browser
    return env


def process_snapshot():
    rows = {}
    for line in command(["ps", "-axo", "pid=,ppid=,pgid=,stat=,lstart="]).splitlines():
        values = line.split(None, 4)
        require(len(values) == 5, "Incomplete process identity telemetry")
        pid, parent, group = map(int, values[:3])
        if not values[3].startswith("Z"):
            rows[pid] = {"parent": parent, "group": group, "identity": " ".join(values[4].split())}
    return rows


class OwnedProcesses:
    def __init__(self, process):
        self.process = process
        self.identities = {}
        self.groups = set()
        self.live = set()
        self.refresh()

    def refresh(self):
        rows = process_snapshot()
        owned = {pid for pid, row in rows.items() if self.identities.get(pid) == row["identity"]}
        if self.process.poll() is None and self.process.pid in rows:
            require(
                not self.identities.get(self.process.pid)
                or self.identities[self.process.pid] == rows[self.process.pid]["identity"],
                f"Leader PID was recycled: pid={self.process.pid}, "
                f"expected_start={self.identities.get(self.process.pid)!r}, "
                f"observed_start={rows[self.process.pid]['identity']!r}",
            )
            owned.add(self.process.pid)
        while True:
            extended = owned | {pid for pid, row in rows.items() if row["parent"] in owned}
            if extended == owned:
                break
            owned = extended
        for pid in owned:
            self.identities.setdefault(pid, rows[pid]["identity"])
            require(
                self.identities[pid] == rows[pid]["identity"],
                f"Child PID was recycled: pid={pid}, expected_start={self.identities[pid]!r}, "
                f"observed_start={rows[pid]['identity']!r}",
            )
            self.groups.add(rows[pid]["group"])
        self.live = owned
        return rows

    def signal(self, sig):
        rows = self.refresh()
        for group in self.groups:
            members = {pid: row for pid, row in rows.items() if row["group"] == group}
            if not members:
                continue
            require(group > 1 and group != os.getpgrp(), "Refuse unsafe process group")
            require(
                all(self.identities.get(pid) == row["identity"] for pid, row in members.items()),
                "Unknown/recycled group member; no signal sent",
            )
            try:
                os.killpg(group, sig)
            except ProcessLookupError:
                pass

    def close(self, grace_seconds=160):
        self.refresh()
        if not self.live:
            return
        self.signal(signal.SIGTERM)
        deadline = time.monotonic() + grace_seconds
        while self.live and time.monotonic() < deadline:
            self.process.poll()
            time.sleep(0.2)
            self.refresh()
        if self.live:
            self.signal(signal.SIGKILL)
        if self.process.poll() is None:
            self.process.wait(timeout=10)
        self.refresh()
        require(not self.live, "Owned descendants remain; inspect before resuming")


class Runner:
    def __init__(self, repo, guard):
        self.repo, self.guard = repo, guard
        self.stopping = threading.Event()
        self.guard_lock = threading.Lock()
        self.last_check = 0.0

    def healthy(self):
        with self.guard_lock:
            require(not self.stopping.is_set(), "Release was interrupted")
            if time.monotonic() - self.last_check < 5:
                return
            self.last_check = time.monotonic()
            if not self.guard.check():
                self.stopping.set()
                raise RuntimeError(self.guard.reason)

    def run(self, args, output, env=None, probe=None, timeout_seconds=3600):
        self.healthy()
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x") as log:
            process = subprocess.Popen(
                args, cwd=self.repo, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True
            )
            try:
                ownership = OwnedProcesses(process)
            except BaseException:
                # Popen owns this child handle; no guessed process-group signal on telemetry failure.
                process.terminate()
                process.wait(timeout=20)
                raise
            process.release_ownership = ownership
            started = last_progress = time.monotonic()
            try:
                while process.poll() is None:
                    require(
                        time.monotonic() - started < timeout_seconds, f"Stage exceeded {timeout_seconds}s; see {output}"
                    )
                    self.healthy()
                    ownership.refresh()
                    if probe:
                        probe(process)
                    if time.monotonic() - last_progress >= 30:
                        progress(output, started)
                        last_progress = time.monotonic()
                    time.sleep(1)
                require(process.returncode == 0, f"Command failed; see {output}")
            finally:
                cleaned = False
                try:
                    ownership.close(grace_seconds=10 if self.guard.reason else 160)
                    cleaned = True
                finally:
                    atomic_json(
                        output.with_name(output.stem + "-cleanup.json"),
                        {
                            "leader": process.pid,
                            "identities": ownership.identities,
                            "remaining": sorted(ownership.live),
                            "complete": cleaned,
                            "ended": datetime.now(UTC).isoformat(),
                        },
                    )


def ports_available(port):
    for value in (port, port + 1, port + 2):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", value))


def database_probe(port, receipt):
    def probe(process):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port + 1}/api/health", timeout=1) as response:
                payload = json.load(response)
        except (OSError, ValueError):
            return
        database = Path(payload.get("database", "")).resolve()
        require(
            payload.get("ok") is True
            and database.name == "cageledger.sqlite"
            and database.parent.name.startswith("cageledger-e2e-")
            and database.parent.parent == Path(tempfile.gettempdir()).resolve(),
            "Non-isolated browser database",
        )
        listeners = command(["lsof", "-nP", f"-iTCP:{port + 1}", "-sTCP:LISTEN", "-t"])
        require(
            listeners and all(int(pid) in process.release_ownership.live for pid in listeners.split()),
            "Browser listener is outside the owned process group",
        )
        require(not receipt or receipt["database"] == str(database), "Browser database changed")
        receipt.update(database=str(database), port=port, owned_listener=True)

    return probe


def official_origin(url):
    return url.removesuffix(".git") in {
        DEFAULT_GITEA_URL + REPOSITORY_PATH,
        HTTPS_GITEA_URL + REPOSITORY_PATH,
        gitea_url() + REPOSITORY_PATH,
        "git@git.cellnucle.us:hugo/cageledger",
        "ssh://git@git.cellnucle.us/hugo/cageledger",
    }


def remote_ref(repo, ref):
    # Exit 2 alone means absent; connection/auth failures are never absence.
    result = subprocess.run(
        ["git", "ls-remote", "--exit-code", "origin", ref],
        cwd=repo,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if result.returncode == 2:
        return None
    require(result.returncode == 0, "Remote ref state is unknown; publication stopped")
    rows = [line.split() for line in result.stdout.splitlines()]
    require(len(rows) == 1 and rows[0][1] == ref, "Ambiguous remote ref")
    return rows[0][0]


def reconcile_ref(actual, expected):
    require(actual in (None, expected), "Remote ref conflicts with this release; will not overwrite")
    return actual == expected


def manifest_result(result, image):
    """Accept only a structured manifest or an exact, image-scoped Docker absence."""
    if result.returncode == 0:
        require(not result.stderr.strip(), "Registry returned contradictory diagnostics")
        try:
            manifest = json.loads(result.stdout)
        except (ValueError, TypeError) as error:
            raise RuntimeError("Registry returned an invalid manifest") from error
        require(
            isinstance(manifest, dict) and manifest.get("schemaVersion") == 2, "Registry returned an ambiguous manifest"
        )
        require(
            (isinstance(manifest.get("manifests"), list) and bool(manifest["manifests"]))
            or (isinstance(manifest.get("config"), dict) and isinstance(manifest.get("layers"), list)),
            "Registry response is not an image/index manifest",
        )
        return hashed(manifest)
    missing = {
        f"ERROR: {image}: not found",
        f"ERROR: {image}: manifest unknown",
        f"ERROR: {image}: manifest unknown: manifest unknown",
    }
    require(
        result.returncode == 1 and not result.stdout.strip() and result.stderr.strip() in missing,
        "Registry state unknown; no mutation allowed",
    )
    return None


def manifest_identity(repo, image):
    result = subprocess.run(
        ["docker", "buildx", "imagetools", "inspect", "--raw", image],
        cwd=repo,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    return manifest_result(result, image)


def changed_paths(repo):
    return set(filter(None, command(["git", "diff", "--name-only", "-z", "HEAD"], repo).split("\0")))


def validate_build(state, repo):
    data = json.loads(Path(state).read_text())
    require(data["identity"]["repo"] == str(repo.resolve()), "Build receipt checkout mismatch")
    runtime = runtime_fingerprint(repo)
    journal = Journal(Path(state).parent, data["identity"])
    require(
        journal.reusable("build", hashed({"source": source_fingerprint(repo), "runtime": runtime})),
        "Build receipt stale or artifact changed",
    )
