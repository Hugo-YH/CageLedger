"""Journaled local release. No action occurs on import; --dry-run is read-only.

A completed receipt is reusable only for identical inputs and intact outputs.
Interrupted mutations are reconciled, never blindly retried. Evidence is local,
not a signature or a substitute for a trusted checkout/host.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path
from uuid import uuid4

from release_credentials import config, record_signing, verify_signing
from release_images import IMAGE_PLATFORMS
from release_runtime import (
    RELEASE_FILES,
    Journal,
    Runner,
    atomic_json,
    cases,
    changed_paths,
    command,
    converter_identity,
    database_probe,
    digest,
    hashed,
    isolation_environment,
    manifest_identity,
    official_origin,
    ports_available,
    reconcile_ref,
    remote_ref,
    require,
    runtime_fingerprint,
    source_fingerprint,
    specs,
    tree,
)
from release_runtime import ROOT as ROOT


def verify_compatibility_catalog(repo, report):
    expected = json.loads((repo / "tests/e2e/compatibility-catalog.json").read_text())
    require(
        isinstance(expected, list) and expected and len(expected) == len(set(expected)), "Invalid compatibility catalog"
    )
    selected = [
        "@" + tag.lstrip("@")
        for spec in specs(report["suites"])
        for tag in spec.get("tags", [])
        if tag.lstrip("@").startswith("compat-")
    ]
    require(
        set(selected) == set(expected) and len(selected) == len(expected),
        "Compatibility tags missing/duplicated; inspect explicit catalog",
    )


class Pipeline:
    def __init__(self, repo, version, directory, guard, browser_slots=1, sign=False):
        require(type(browser_slots) is int and browser_slots in (1, 2), "Browser slots must be 1 or 2")
        self.browser_slots = browser_slots
        self.repo, self.version = repo, version
        self.journal = Journal(directory, {"repo": str(repo.resolve()), "version": version})
        if self.journal.data["stages"].get("images") or self.journal.data.get("image_manifest"):
            require(
                self.journal.data.get("image_platforms") == IMAGE_PLATFORMS,
                "Image publication state uses an obsolete architecture policy; inspect before resuming",
            )
        self.journal.data["image_platforms"] = list(IMAGE_PLATFORMS)
        self.journal.save()
        self.sign = sign
        record_signing(self.journal, sign)
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
        self.journal.data["converter"] = converter_identity()
        self.journal.save()
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
        require(
            config(self.repo, "user.name") and config(self.repo, "user.email"),
            "Configure Git user.name and user.email before release",
        )
        if self.sign:
            self.journal.data["signing_probe"] = verify_signing(self.repo)
            self.journal.save()
            self.environment = isolation_environment()
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
            for suffix in ("", "-arm64"):
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

    def browser_capacity(self):
        # Admission and the runtime guard remain authoritative. This stricter
        # scheduling budget only decides whether to start a second group.
        self.runner.healthy()
        guard = self.runner.guard
        sample = guard.sample
        if self.browser_slots == 2 and (
            sample["free_percent"] >= 45
            and sample["load1"] <= guard.policy.cpus
            and sample["swap_mib"] - guard.policy.baseline_swap <= 256
        ):
            return 2
        return 1

    def browsers(self):
        self.verify_runtime()
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
            verify_compatibility_catalog(self.repo, json.loads(text))
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
                    "topology": "3-shards-resource-slots-v2",
                    "maximum_slots": self.browser_slots,
                }
            )
            entry = self.journal.data["stages"].get(name, {})
            if self.journal.reusable(name, key):
                report = json.loads(Path(entry["report"]).read_text())
                if engine != "chromium":
                    verify_compatibility_catalog(self.repo, report)
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
                if engine != "chromium":
                    verify_compatibility_catalog(self.repo, report)
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

        # Never increase concurrency again after pressure reduces this run's budget.
        # Every group retains its own ports/database, even when run sequentially.
        slots = self.browser_slots
        pending, active, results = list(jobs), {}, {}
        failure = None
        with ThreadPoolExecutor(max_workers=self.browser_slots) as pool:
            while pending or active:
                slots = min(slots, self.browser_capacity())
                while pending and len(active) < slots and failure is None:
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
        chromium_suites = []
        databases = []
        for name, engine, _, _ in jobs:
            report = json.loads(Path(results[name]["report"]).read_text())
            if engine == "chromium":
                found.extend(cases(report, engine, True))
                chromium_suites.extend(report["suites"])
            databases.append(results[name]["health"]["database"])
        require(
            set(found) == catalogs["chromium"] and all(n == 1 for n in Counter(found).values()),
            "Chromium coverage is not exact-once",
        )
        require(len(set(databases)) == 5, "Browser databases were shared")
        verify_compatibility_catalog(self.repo, {"suites": chromium_suites})
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
            # Persist the intended tree before commit; interrupted commits can be reconciled.
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
                command(
                    [
                        "git",
                        "-c",
                        f"commit.gpgsign={str(self.sign).lower()}",
                        "commit",
                        "-S" if self.sign else "--no-gpg-sign",
                        "-m",
                        f"Release v{self.version}",
                    ],
                    self.repo,
                )
            self.journal.data["commit"] = command(["git", "rev-parse", "HEAD"], self.repo)
            self.journal.save()
        require(command(["git", "rev-parse", "HEAD"], self.repo) == self.journal.data["commit"], "Release HEAD changed")
        if self.sign:
            command(["git", "verify-commit", "HEAD"], self.repo)
        tag = f"v{self.version}"
        exists = subprocess.run(
            ["git", "show-ref", "--verify", "--quiet", f"refs/tags/{tag}"], cwd=self.repo, check=False
        )
        if exists.returncode != 0:
            command(
                [
                    "git",
                    "-c",
                    f"tag.gpgsign={str(self.sign).lower()}",
                    "tag",
                    "-s" if self.sign else "-a",
                    tag,
                    "-m",
                    tag,
                ],
                self.repo,
            )
        require(
            command(["git", "cat-file", "-t", f"refs/tags/{tag}"], self.repo) == "tag", "Release tag must be annotated"
        )
        if self.sign:
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

        from release_images import publish_images

        publish_images(self)
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


def main():
    from release_cli import main as run

    run(Pipeline)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from error
