"""Journaled local release. No action occurs on import; --dry-run is read-only.

A completed receipt is reusable only for identical inputs and intact outputs.
Interrupted mutations are reconciled, never blindly retried. Evidence is local,
not a signature or a substitute for a trusted checkout/host.
"""

import argparse
import fcntl
import hashlib
import json
import os
import re
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import contextmanager
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

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


def command(args, cwd=ROOT, *, env=None, timeout=120):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout, check=False)
    require(result.returncode == 0, f"{args[0]} failed (exit {result.returncode}); inspect the phase log")
    return result.stdout.strip()


def source_fingerprint(repo):
    names = command(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], repo).split("\0")
    return hashed(
        {name: digest(repo / name) if (repo / name).exists() else "missing" for name in sorted(set(names)) if name}
    )


def runtime_fingerprint(repo):
    script = "import {chromium,firefox,webkit} from 'playwright'; console.log(JSON.stringify([chromium,firefox,webkit].map(b=>b.executablePath())))"
    paths = json.loads(command(["node", "--input-type=module", "-e", script], repo, env=isolation_environment()))
    # Hash browser bundles, not merely a version string or executable pathname.
    installations = set()
    for executable in paths:
        bundle = next(
            (p for p in Path(executable).parents if re.fullmatch(r"(?:chromium|firefox|webkit)-[0-9]+", p.name)), None
        )
        require(bundle is not None, "Unsupported browser installation layout")
        installations.add(bundle)
        if bundle.name.startswith("chromium-"):
            installations.update(bundle.parent.glob("chromium_headless_shell-*"))
    browsers = {str(p): tree(p) for p in sorted(installations)}
    return hashed(
        {
            "python": digest(Path(sys.executable).resolve()),
            "python_version": sys.version,
            "node": command(["node", "--version"], repo),
            "node_binary": digest(command(["node", "-p", "process.execPath"], repo)),
            "platform": command(["uname", "-a"], repo),
            "browsers": browsers,
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
    )
    return env


def process_snapshot():
    rows = {}
    for line in command(["ps", "-axo", "pid=,ppid=,pgid=,stat=,lstart="]).splitlines():
        values = line.split(None, 4)
        require(len(values) == 5, "Incomplete process identity telemetry")
        pid, parent, group = map(int, values[:3])
        if not values[3].startswith("Z"):
            rows[pid] = {"parent": parent, "group": group, "identity": values[4]}
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
                "Leader PID was recycled",
            )
            owned.add(self.process.pid)
        while True:
            extended = owned | {pid for pid, row in rows.items() if row["parent"] in owned}
            if extended == owned:
                break
            owned = extended
        for pid in owned:
            self.identities.setdefault(pid, rows[pid]["identity"])
            require(self.identities[pid] == rows[pid]["identity"], "Child PID was recycled")
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

    def close(self):
        self.refresh()
        if not self.live:
            return
        self.signal(signal.SIGTERM)
        deadline = time.monotonic() + 160
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

    def run(self, args, output, env=None, probe=None):
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
            try:
                while process.poll() is None:
                    self.healthy()
                    ownership.refresh()
                    if probe:
                        probe(process)
                    time.sleep(1)
                require(process.returncode == 0, f"Command failed; see {output}")
            finally:
                ownership.close()


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
        "http://ddns.cellnucle.us:3333/hugo/cageledger",
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


class Pipeline:
    def __init__(self, repo, version, directory, guard):
        self.repo, self.version = repo, version
        self.journal = Journal(directory, {"repo": str(repo.resolve()), "version": version})
        self.runner = Runner(repo, guard)
        self.environment = isolation_environment()
        self.input = None
        self.runtime = None
        self.runtime_lock = threading.Lock()

    def fingerprint(self):
        return hashed({"source": source_fingerprint(self.repo), "runtime": self.runtime})

    def verify_runtime(self):
        with self.runtime_lock:
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(runtime_fingerprint, self.repo)
                while not future.done():
                    self.runner.healthy()
                    time.sleep(1)
                require(future.result() == self.runtime, "Dependency/browser runtime changed during release")

    def stage(self, name, args, outputs=(), env=None, inputs=()):
        self.verify_runtime()
        source_input = self.fingerprint()
        artifact_input = {str(path): tree(path) for path in inputs}
        fingerprint = hashed({"source": source_input, "artifacts": artifact_input}) if inputs else source_input
        if self.journal.reusable(name, fingerprint):
            print(f"Reuse verified {name}", flush=True)
            return
        attempt = self.journal.begin(name, fingerprint)
        try:
            log = attempt / "command.log"
            self.runner.run(args, log, env=env or self.environment)
            self.verify_runtime()
            require(
                self.fingerprint() == source_input and artifact_input == {str(path): tree(path) for path in inputs},
                f"Input changed during {name}",
            )
            self.journal.end(name, "passed", [log, *outputs], exit_code=0, command=args)
        except BaseException as error:
            self.journal.end(name, "failed", reason=str(error))
            raise

    def preflight(self):
        require(sys.version_info >= (3, 13), "Python 3.13 required")
        node_version = command(["node", "-p", "process.versions.node"], self.repo).split(".")
        require(int(node_version[0]) == 22 and int(node_version[1]) >= 12, "Node >=22.12 <23 required")
        require(not (self.repo / ".env").exists(), "Release requires an env-free isolated checkout")
        branch = command(["git", "branch", "--show-current"], self.repo)
        require(
            branch == "main" if not re.search(r"-(beta|rc)\d+$", self.version) else branch in {"main", "beta", "rc"},
            "Invalid release branch",
        )
        changed = changed_paths(self.repo)
        require(set(changed) <= RELEASE_FILES, "Commit application/tool changes before releasing")
        require(
            not command(["git", "ls-files", "--others", "--exclude-standard"], self.repo),
            "Untracked source files present",
        )
        if not self.journal.data.get("commit_intent"):
            command(["git", "diff", "--cached", "--exit-code"], self.repo)
        command(["docker", "info"], self.repo)
        command(["docker", "buildx", "version"], self.repo)
        command(["node", "scripts/check_python_runtime.mjs"], self.repo)
        command(["node", "scripts/release_notes_payload.mjs", "--version", self.version, "--check"], self.repo)
        for key in ("commit.gpgsign", "tag.gpgsign"):
            require(
                command(["git", "config", "--get", key], self.repo).lower() == "true", f"Enable {key} before release"
            )
        command(["git", "config", "--get", "user.signingkey"], self.repo)
        if branch in {"main", "rc"}:
            command(
                ["bash", "scripts/check_stable_release_ready.sh" if branch == "main" else "scripts/check_rc_merged.sh"],
                self.repo,
            )
        from release_verify_delivery import BASE, Client, gitea_authorization

        require(
            official_origin(command(["git", "remote", "get-url", "origin"], self.repo)),
            "Managed verification currently supports the official origin only",
        )
        client = Client(BASE, authorization=gitea_authorization())
        repository = client.json("/api/v1/repos/hugo/cageledger")
        require(
            repository.get("permissions", {}).get("push") is True,
            "Release account has no verified repository push permission",
        )
        head = command(["git", "rev-parse", "HEAD"], self.repo)
        remote = remote_ref(self.repo, f"refs/heads/{branch}")
        require(remote is not None, "Release branch missing on origin")
        command(["git", "merge-base", "--is-ancestor", remote, head], self.repo)
        self.branch = branch
        self.preflight_remote = remote
        from release_verify_delivery import IMAGE

        if "latest_baseline" not in self.journal.data:
            self.journal.data["latest_baseline"] = manifest_identity(self.repo, f"{IMAGE}:latest")
            self.journal.save()
        if not self.journal.data["stages"].get("images"):
            for suffix in ("", "-arm64", "-amd64"):
                require(
                    manifest_identity(self.repo, f"{IMAGE}:{self.version}{suffix}") is None,
                    "Version image already exists; inspect before testing",
                )
        self.runtime = runtime_fingerprint(self.repo)
        self.journal.data["runtime_digest"] = self.runtime
        self.journal.data.setdefault("source_commit", head)
        self.journal.save()
        state_commit = self.journal.data.get("commit")
        tag = subprocess.run(
            ["git", "rev-parse", "-q", "--verify", f"refs/tags/v{self.version}"],
            cwd=self.repo,
            capture_output=True,
            text=True,
            check=False,
        )
        if tag.returncode == 0:
            require(state_commit == head, "Existing local tag has no matching release journal")
            require(
                command(["git", "rev-parse", f"v{self.version}^{{commit}}"], self.repo) == head, "Local tag conflict"
            )
        remote_tag = remote_ref(self.repo, f"refs/tags/v{self.version}")
        require(
            remote_tag is None or (tag.returncode == 0 and remote_tag == tag.stdout.strip()),
            "Remote version already exists/conflicts",
        )

    def prepare(self):
        if self.journal.data.get("commit_intent"):
            return
        if self.journal.data.get("commit"):
            require(
                self.journal.data["commit"] == command(["git", "rev-parse", "HEAD"], self.repo),
                "HEAD changed since release commit",
            )
            return
        text = (self.repo / "wiki/更新日志.md").read_text()
        match = re.search(r"^##\s+" + re.escape(self.version) + r"（Build (\d+)）", text, re.M)
        build = int(match[1]) if match else max(map(int, re.findall(r"^## .*（Build (\d+)）", text, re.M))) + 1
        command(["node", "scripts/set_version.mjs", "--version", self.version, "--build", str(build)], self.repo)
        command(["node", "scripts/sync_release_notes_from_docs.mjs"], self.repo)
        command(["node", "scripts/release_notes_payload.mjs", "--version", self.version, "--check"], self.repo)

    def browsers(self):
        fingerprint = self.fingerprint()
        catalog_dir = self.journal.directory / ("catalog-" + uuid4().hex)
        catalog_dir.mkdir()
        cli = ["node", "node_modules/@playwright/test/cli.js", "test", "--workers=1", "--retries=0"]
        catalogs = {}
        for engine in ("chromium", "firefox", "webkit"):
            env = {**self.environment, "CAGELEDGER_COMPAT_BROWSER": engine}
            args = cli + ([] if engine == "chromium" else ["--config", "playwright.compat.config.ts"])
            text = command(args + ["--list", "--reporter=json"], self.repo, env=env)
            atomic_json(catalog_dir / f"{engine}.json", json.loads(text))
            catalogs[engine] = set(cases(json.loads(text), engine, False))
        jobs = [(f"chromium-{i}", "chromium", i, 5613 + (i - 1) * 10) for i in range(1, 4)]
        jobs += [("firefox", "firefox", None, 5643), ("webkit", "webkit", None, 5653)]

        def execute(job):
            name, engine, shard, port = job
            key = hashed(
                {
                    "input": fingerprint,
                    "engine": engine,
                    "shard": shard,
                    "catalog": sorted(catalogs[engine]),
                    "topology": "3-shards-2-slots-v1",
                }
            )
            entry = self.journal.data["stages"].get(name, {})
            if self.journal.reusable(name, key):
                report = json.loads(Path(entry["report"]).read_text())
                cases(report, engine, True)
                return entry
            ports_available(port)
            attempt = self.journal.begin(name, key)
            attempt.mkdir(parents=True)
            output = attempt if engine == "chromium" else attempt / engine
            env = {
                **self.environment,
                "CAGELEDGER_E2E_PORT": str(port),
                "CAGELEDGER_E2E_API_PORT": str(port + 1),
                "CAGELEDGER_DOCS_PORT": str(port + 2),
                "CAGELEDGER_E2E_OUTPUT_DIR": str(attempt),
                "CAGELEDGER_COMPAT_OUTPUT_DIR": str(attempt),
                "CAGELEDGER_COMPAT_BROWSER": engine,
            }
            args = cli + ([f"--shard={shard}/3"] if shard else ["--config", "playwright.compat.config.ts"])
            health = {}
            try:
                self.runner.run(args, attempt / "command.log", env, database_probe(port, health))
                report_path = output / "results.json"
                report = json.loads(report_path.read_text())
                found = set(cases(report, engine, True))
                require(found <= catalogs[engine] if shard else found == catalogs[engine], "Browser catalog mismatch")
                require(report["config"]["shard"] == ({"current": shard, "total": 3} if shard else None), "Wrong shard")
                require(health and self.fingerprint() == fingerprint, "Missing isolation receipt or changed input")
                atomic_json(attempt / "isolation.json", health)
                self.journal.end(
                    name,
                    "passed",
                    [report_path, attempt / "isolation.json", attempt / "command.log", catalog_dir / f"{engine}.json"],
                    exit_code=0,
                    command=args,
                    report=str(report_path),
                    health=health,
                )
                return self.journal.data["stages"][name]
            except BaseException as error:
                self.journal.end(name, "failed", reason=str(error))
                raise

        # Two slots, work-conserving; Firefox and WebKit retain their serial relation.
        pending, active, results = list(jobs), {}, {}
        failure = None
        with ThreadPoolExecutor(max_workers=2) as pool:
            while pending or active:
                while pending and len(active) < 2 and failure is None:
                    index = next((i for i, j in enumerate(pending) if j[0] != "webkit" or "firefox" in results), None)
                    if index is None:
                        break
                    job = pending.pop(index)
                    active[pool.submit(execute, job)] = job[0]
                if not active:
                    break
                done, _ = wait(active, return_when=FIRST_COMPLETED)
                for future in done:
                    name = active.pop(future)
                    try:
                        results[name] = future.result()
                    except BaseException as error:
                        failure = error
                # A test failure stops new tasks but lets already-running independent work finish.
                if failure and not active:
                    raise failure
        require(len(results) == 5, "Incomplete browser stages")
        found = []
        databases = []
        for name, engine, _, _ in jobs:
            report = json.loads(Path(results[name]["report"]).read_text())
            if engine == "chromium":
                found.extend(cases(report, engine, True))
            databases.append(results[name]["health"]["database"])
        require(
            set(found) == catalogs["chromium"] and all(n == 1 for n in Counter(found).values()),
            "Chromium coverage is not exact-once",
        )
        require(len(set(databases)) == 5, "Browser databases were shared")
        self.verify_runtime()
        require(self.fingerprint() == fingerprint, "Browser source changed")
        self.journal.data["browser_input"] = fingerprint
        self.journal.save()

    def mutation(self, name, args, reconcile):
        previous = self.journal.data["stages"].get(name)
        outcome = reconcile(previous)
        require(outcome in {"present", "absent"}, f"{name}: remote state unknown/conflicting; inspect before resuming")
        if outcome == "present":
            return
        attempt = self.journal.begin(name, self.fingerprint(), mutation=True)
        try:
            self.runner.run(args, attempt / "command.log", env={**os.environ, "CAGELEDGER_PYTHON_BIN": sys.executable})
            require(reconcile(self.journal.data["stages"][name]) == "present", f"{name}: postcondition not confirmed")
            self.journal.end(name, "passed", [attempt / "command.log"], exit_code=0, command=args)
        except BaseException as error:
            self.journal.end(name, "unknown", reason=str(error))
            raise

    def commit_and_tag(self):
        require(
            remote_ref(self.repo, f"refs/heads/{self.branch}") == self.preflight_remote,
            "Remote branch moved during tests; inspect before commit/tag",
        )
        self.verify_runtime()
        require(self.journal.data.get("browser_input") == self.fingerprint(), "Browser evidence is stale")
        if not self.journal.data.get("commit"):
            require(
                changed_paths(self.repo) <= RELEASE_FILES,
                "Unexpected modified source before commit",
            )
            # Persist the intended tree before commit; interrupted signed commits can be reconciled.
            command(["git", "add", "--", *sorted(RELEASE_FILES)], self.repo)
            expected_tree = command(["git", "write-tree"], self.repo)
            previous = self.journal.data.get("commit_intent")
            if previous and command(["git", "rev-parse", "HEAD"], self.repo) != previous["parent"]:
                require(
                    command(["git", "rev-parse", "HEAD^{tree}"], self.repo) == previous["tree"]
                    and command(["git", "rev-parse", "HEAD^"], self.repo) == previous["parent"],
                    "Interrupted commit requires inspection; no duplicate commit",
                )
            else:
                require(not previous or expected_tree == previous["tree"], "Interrupted commit input changed")
                self.journal.data["commit_intent"] = {
                    "tree": expected_tree,
                    "parent": command(["git", "rev-parse", "HEAD"], self.repo),
                }
                self.journal.save()
                command(["git", "commit", "-S", "-m", f"Release v{self.version}"], self.repo)
            command(["git", "verify-commit", "HEAD"], self.repo)
            self.journal.data["commit"] = command(["git", "rev-parse", "HEAD"], self.repo)
            self.journal.save()
        command(["git", "verify-commit", "HEAD"], self.repo)
        tag = f"v{self.version}"
        exists = subprocess.run(
            ["git", "show-ref", "--verify", "--quiet", f"refs/tags/{tag}"], cwd=self.repo, check=False
        )
        if exists.returncode != 0:
            command(["git", "tag", "-s", tag, "-m", tag], self.repo)
        command(["git", "verify-tag", tag], self.repo)
        require(
            command(["git", "rev-parse", tag + "^{commit}"], self.repo) == self.journal.data["commit"],
            "Tag commit mismatch",
        )

    def publish(self):
        from release_verify_delivery import BASE, IMAGE, Client, gitea_authorization

        client = Client(BASE, authorization=gitea_authorization())
        version = self.version
        revision = self.journal.data["commit"]
        archive = self.repo / "dist" / f"CageLedger-offline-{version}.tar.gz"
        require(
            remote_ref(self.repo, f"refs/heads/{self.branch}") in {self.preflight_remote, revision},
            "Remote branch moved before publishing",
        )

        # Image builder cannot safely infer ownership after a partial push. Preserve and stop.
        def image_state(previous):
            if previous and previous["status"] == "passed":
                actual = command(
                    ["docker", "buildx", "imagetools", "inspect", "--raw", f"{IMAGE}:{version}"], self.repo
                )
                require(hashed(json.loads(actual)) == self.journal.data.get("image_manifest"), "Version image changed")
                require(
                    self.journal.reusable("images", previous["fingerprint"]), "Offline image evidence changed/missing"
                )
                return "present"
            if previous:
                return "unknown"
            for suffix in ("", "-arm64", "-amd64"):
                require(
                    manifest_identity(self.repo, f"{IMAGE}:{version}{suffix}") is None,
                    "Version image already exists; will not overwrite",
                )
            return "absent"

        if image_state(self.journal.data["stages"].get("images")) == "absent":
            attempt = self.journal.begin("images", self.fingerprint(), mutation=True)
            try:
                self.runner.run(
                    [
                        "bash",
                        "scripts/publish_container_local.sh",
                        "--version",
                        version,
                        "--export-offline-images",
                        "--defer-latest",
                    ],
                    attempt / "command.log",
                )
                manifest = json.loads(
                    command(["docker", "buildx", "imagetools", "inspect", "--raw", f"{IMAGE}:{version}"], self.repo)
                )
                self.journal.data["image_manifest"] = hashed(manifest)
                self.journal.end(
                    "images",
                    "passed",
                    [attempt / "command.log", *sorted((self.repo / "dist").glob(f"CageLedger-image-{version}-*"))],
                )
            except BaseException:
                self.journal.end("images", "unknown")
                raise
        else:
            require(
                image_state(self.journal.data["stages"].get("images")) == "present",
                "Partial image publication requires inspection",
            )
        for ref, expected in (
            (f"refs/heads/{self.branch}", revision),
            (f"refs/tags/v{version}", command(["git", "rev-parse", f"refs/tags/v{version}"], self.repo)),
        ):

            def ref_state(_previous, ref=ref, expected=expected):
                actual = remote_ref(self.repo, ref)
                if ref.startswith("refs/heads/") and actual != expected:
                    require(actual is not None, "Remote branch disappeared")
                    command(["git", "merge-base", "--is-ancestor", actual, expected], self.repo)
                    return "absent"
                return "present" if reconcile_ref(actual, expected) else "absent"

            self.mutation("push-" + ref.split("/")[1], ["git", "push", "origin", f"{ref}:{ref}"], ref_state)

        # Read back uncertain uploads: never re-POST a partially existing release automatically.
        def release_state(previous):
            from release_verify_delivery import ReleaseHTTPError

            try:
                value = client.json(f"/api/v1/repos/hugo/cageledger/releases/tags/v{version}")
            except ReleaseHTTPError as error:
                if error.code == 404:
                    return "unknown" if previous else "absent"
                raise
            if value and previous:
                return "present" if self._verify_uploaded(client, archive) else "unknown"
            if value:
                return "unknown"
            return "unknown"

        self.mutation(
            "release",
            ["bash", "scripts/upload_release_package_local.sh", "--version", version, "--package", str(archive)],
            release_state,
        )
        self.stage(
            "wiki", ["bash", "scripts/sync_wiki_local.sh"], env={**os.environ, "CAGELEDGER_PYTHON_BIN": sys.executable}
        )
        common = [
            "--repo-dir",
            str(self.repo),
            "--expected-version",
            version,
            "--expected-build",
            str(json.loads((self.repo / "package.json").read_text())["build"]),
            "--expected-revision",
            revision,
        ]
        # These existing checks run on fresh disposable containers / databases, never production.
        verify_dir = self.journal.directory / ("delivery-" + uuid4().hex)
        self.stage(
            "delivery",
            [
                sys.executable,
                "scripts/release_verify_delivery.py",
                *common,
                "--required-branch",
                self.branch,
                "--output-dir",
                str(verify_dir),
            ],
            [verify_dir],
            inputs=[archive],
            env={**os.environ, "CAGELEDGER_PYTHON_BIN": sys.executable},
        )
        offline_dir = self.journal.directory / ("offline-" + uuid4().hex)
        self.stage(
            "offline-smoke",
            [sys.executable, "scripts/release_verify_offline.py", *common, "--output-dir", str(offline_dir)],
            [offline_dir],
            inputs=[archive, self.repo / "web-dist"],
            env={**os.environ, "CAGELEDGER_PYTHON_BIN": sys.executable},
        )
        remote_dir = self.journal.directory / ("remote-" + uuid4().hex)
        self.stage(
            "remote-" + uuid4().hex,
            [
                sys.executable,
                "scripts/release_verify_delivery.py",
                *common,
                "--required-branch",
                self.branch,
                "--stage",
                "remote",
                "--output-dir",
                str(remote_dir),
            ],
            [remote_dir],
            env={**os.environ, "CAGELEDGER_PYTHON_BIN": sys.executable},
        )
        # Always recheck remote refs and asset hash before changing the moving alias.
        require(
            remote_ref(self.repo, f"refs/heads/{self.branch}") == revision, "Remote branch moved; latest not changed"
        )
        require(
            remote_ref(self.repo, f"refs/tags/v{version}")
            == command(["git", "rev-parse", f"refs/tags/v{version}"], self.repo),
            "Remote tag changed",
        )
        require(self._verify_uploaded(client, archive), "Published asset/body no longer matches")

        def latest_state(_previous):
            require(remote_ref(self.repo, f"refs/heads/{self.branch}") == revision, "Remote branch moved")
            require(
                manifest_identity(self.repo, f"{IMAGE}:{version}") == self.journal.data["image_manifest"],
                "Version manifest changed",
            )
            actual = manifest_identity(self.repo, f"{IMAGE}:latest")
            if actual == self.journal.data["image_manifest"]:
                return "present"
            require(actual == self.journal.data["latest_baseline"], "Another publisher moved latest; stop")
            return "absent"

        self.mutation(
            "latest",
            ["docker", "buildx", "imagetools", "create", "-t", f"{IMAGE}:latest", f"{IMAGE}:{version}"],
            latest_state,
        )

    def _verify_uploaded(self, client, archive):
        import urllib.parse

        from release_verify_delivery import BASE

        release = client.json(f"/api/v1/repos/hugo/cageledger/releases/tags/v{self.version}")
        require(not release.get("draft") and release.get("tag_name") == f"v{self.version}", "Release still incomplete")
        expected_dir = self.journal.directory / ("notes-" + uuid4().hex)
        expected_dir.mkdir(parents=True)
        command(
            ["node", "scripts/release_notes_payload.mjs", "--version", self.version, "--output-dir", str(expected_dir)],
            self.repo,
        )
        expected = json.loads((expected_dir / "release-create.json").read_text())
        require(
            release.get("body", "").replace("\r\n", "\n").strip() == expected["body"].strip(), "Release notes differ"
        )
        assets = [a for a in release.get("assets", []) if a["name"] == archive.name]
        require(len(assets) == 1, "Release asset missing/duplicated")
        url = assets[0]["browser_download_url"]
        require(urllib.parse.urlsplit(url)[:2] == urllib.parse.urlsplit(BASE)[:2], "Unexpected asset origin")
        request = urllib.request.Request(url, headers={"Authorization": client.authorization})
        with client.opener.open(request, timeout=120) as response:
            require(hashlib.file_digest(response, "sha256").hexdigest() == digest(archive), "Remote asset SHA mismatch")
        return True


def validate_build(state, repo):
    data = json.loads(Path(state).read_text())
    require(data["identity"]["repo"] == str(repo.resolve()), "Build receipt checkout mismatch")
    runtime = runtime_fingerprint(repo)
    journal = Journal(Path(state).parent, data["identity"])
    require(
        journal.reusable("build", hashed({"source": source_fingerprint(repo), "runtime": runtime})),
        "Build receipt stale or artifact changed",
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("positional_version", nargs="?")
    parser.add_argument("--version")
    parser.add_argument("--bump")
    parser.add_argument("--push", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--skip-full-verify", action="store_true", help="Compatibility alias: reuse only verified matching receipts"
    )
    parser.add_argument("--state-dir", type=Path)
    parser.add_argument("--validate-build", type=Path)
    parser.add_argument(
        "--verify-only", action="store_true", help="Prepare and verify without committing/tagging/pushing"
    )
    args = parser.parse_args()
    if args.validate_build:
        validate_build(args.validate_build, ROOT)
        return
    version = args.version or args.positional_version
    if not version:
        version = command(["node", "scripts/bump_version.mjs", "--bump", args.bump or "beta"])
    require(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.-]*", version), "Invalid version")
    if args.dry_run:
        print("preflight → prepare → check → build → 3 Chromium shards + Firefox + WebKit (2 slots) → offline package")
        print("→ signed commit/tag" if not args.verify_only else "→ stop before commit/tag")
        if args.push and not args.verify_only:
            print("→ version images → Git refs → Release → Wiki → delivery/offline verification → latest")
        return
    from release_host_guard import HostGuard

    common = Path(command(["git", "rev-parse", "--git-common-dir"]))
    if not common.is_absolute():
        common = ROOT / common
    directory = (args.state_dir or (ROOT.parent / (ROOT.name + "-release-state") / version)).resolve()
    # State must be excluded from source fingerprints and archive packaging.
    require(
        not directory.is_relative_to(ROOT),
        "State must be outside checkout",
    )
    with release_lock(ROOT):
        guard = HostGuard(directory / "host")
        pipeline = Pipeline(ROOT, version, directory, guard)
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda _s, _f: pipeline.runner.stopping.set())
        pipeline.preflight()
        require(guard.admit(), guard.reason)
        pipeline.prepare()
        frozen = pipeline.journal.data.get("release_input")
        require(
            not frozen or frozen == pipeline.fingerprint(),
            "Release input/runtime changed after commit; use a new version",
        )
        pipeline.stage("check", ["npm", "run", "check"])
        pipeline.stage("build", ["npm", "run", "build"], [ROOT / "web-dist", ROOT / ".vitepress/dist"])
        pipeline.browsers()
        package = ROOT / "dist" / f"CageLedger-offline-{version}.tar.gz"
        pipeline.stage(
            "package",
            ["bash", "scripts/package_offline.sh"],
            [package],
            env={**pipeline.environment, "CAGELEDGER_RELEASE_BUILD_RECEIPT": str(pipeline.journal.path)},
            inputs=[ROOT / "web-dist", ROOT / ".vitepress/dist"],
        )
        from release_verify_offline import archive_check

        with tarfile.open(package) as bundle:
            package_safety = archive_check(bundle, ROOT)
        atomic_json(directory / "package-safety.json", {"sha256": digest(package), **package_safety})
        if not args.verify_only:
            pipeline.journal.data["release_input"] = pipeline.fingerprint()
            pipeline.journal.save()
            pipeline.commit_and_tag()
            if args.push:
                pipeline.publish()
        print(f"Release stages complete; evidence: {directory}")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from error
