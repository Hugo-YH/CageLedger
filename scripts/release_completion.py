"""Durable release completion evidence and fast-forward-only housekeeping."""

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path

from release_runtime import atomic_json, command, digest, process_snapshot, remote_ref, require


def protected_files(root):
    paths = [root / ".env", *(root / "data").rglob("*")]
    values = {}
    for path in paths:
        if path.is_symlink():
            require(
                path.is_file(),
                "Protected path contains a directory/broken symlink; use a fully covered source directory",
            )
            with path.open("rb") as stream:
                content = hashlib.file_digest(stream, "sha256").hexdigest()
            values[str(path.relative_to(root))] = hashlib.sha256((digest(path) + content).encode()).hexdigest()
        elif path.is_file():
            values[str(path.relative_to(root))] = digest(path)
    return values


def resources(directory):
    path = directory / "host/host-processes.jsonl"
    result = {"samples": 0, "minimum_free_percent": None, "peak_swap_mib": None, "pressure_levels": []}
    if path.exists():
        with path.open() as stream:
            for line in stream:
                sample = json.loads(line)
                result["samples"] += 1
                result["pressure_levels"] = sorted(set([*result["pressure_levels"], sample["pressure_level"]]))
                for source, target, aggregate in (
                    ("free_percent", "minimum_free_percent", min),
                    ("swap_mib", "peak_swap_mib", max),
                ):
                    if source in sample:
                        previous = result[target]
                        result[target] = sample[source] if previous is None else aggregate(previous, sample[source])
    return result


def cleanup_evidence(directory):
    current = process_snapshot()
    reports = []
    for path in sorted(directory.rglob("*-cleanup.json")):
        value = json.loads(path.read_text())
        alive = [
            int(pid)
            for pid, identity in value["identities"].items()
            if current.get(int(pid), {}).get("identity") == identity
        ]
        complete = not alive and (value["complete"] or bool(value["identities"]))
        reports.append(
            {
                "file": str(path),
                "complete": complete,
                "initial_cleanup_complete": value["complete"],
                "remaining_owned_pids": alive,
            }
        )
    containers = []
    for path in sorted(directory.glob("delivery-*/**/container-smoke.json")):
        value = json.loads(path.read_text())
        complete = value.get("owned_container_stopped") is True
        name = value.get("owned_container_name", "")
        if not complete and re.fullmatch(r"cageledger-release-[0-9A-Za-z.-]+-(?:arm64|amd64)-[0-9a-f]{12}", name):
            # A failed Docker cleanup probe may recover later. Confirm absence of
            # that exact owned name; never remove a possibly replaced container.
            complete = not command(["docker", "ps", "-a", "--filter", f"name=^/{name}$", "--format", "{{.ID}}"])
        containers.append({"file": str(path), "complete": complete})
    return {
        "processes": reports,
        "containers": containers,
        "complete": bool(reports) and all(r["complete"] for r in [*reports, *containers]),
    }


class Completion:
    def __init__(self, pipeline, source=None):
        self.pipeline = pipeline
        self.journal = pipeline.journal
        self.directory = self.journal.directory
        self.source = Path(source).expanduser().resolve() if source else None
        identity = str(self.source) if self.source else None
        require(
            self.journal.data.get("source_checkout", identity) == identity,
            "Resume requires the original --source-checkout",
        )
        self.journal.data["source_checkout"] = identity
        self.converter = None
        if self.source:
            require(self.source != pipeline.repo.resolve(), "Source checkout must be separate from release checkout")
            require(
                command(["git", "rev-parse", "--show-toplevel"], self.source) == str(self.source),
                "Invalid source checkout",
            )
            path = self.directory / "original-files-before.json"
            if not path.exists():
                atomic_json(path, protected_files(self.source))
        self.journal.save()

    def synchronize(self):
        pipeline = self.pipeline
        revision = self.journal.data["commit"]
        report = {}
        if pipeline.branch == "main":
            beta = remote_ref(pipeline.repo, "refs/heads/beta")
            require(beta is not None, "beta missing; inspect branch policy before finalizing")
            command(["git", "fetch", "origin", "refs/heads/beta"], pipeline.repo)
            command(["git", "merge-base", "--is-ancestor", beta, revision], pipeline.repo)
            if beta != revision:
                command(["git", "push", "origin", f"{revision}:refs/heads/beta"], pipeline.repo)
            require(remote_ref(pipeline.repo, "refs/heads/beta") == revision, "beta readback mismatch")
            report["beta"] = revision
        if self.source:
            if (
                command(["git", "status", "--porcelain"], self.source)
                or command(["git", "branch", "--show-current"], self.source) != pipeline.branch
            ):
                report["source_checkout"] = "preserved_dirty_or_different_branch"
            else:
                command(["git", "fetch", "origin", f"refs/heads/{pipeline.branch}"], self.source)
                require(
                    command(["git", "rev-parse", "FETCH_HEAD"], self.source) == revision,
                    "Origin moved before local synchronization",
                )
                command(["git", "merge", "--ff-only", revision], self.source)
                report["source_checkout"] = command(["git", "rev-parse", "HEAD"], self.source)
        return report

    def finish(self, completed, published):
        summary = {
            "finished_at": datetime.now(UTC).isoformat(),
            "version": self.pipeline.version,
            "revision": self.journal.data.get("commit"),
            "signing": self.journal.data["signing"],
            "status": "completed" if completed else "interrupted_or_failed",
            "publication": "verified"
            if published and completed
            else "previously_verified"
            if published
            else "not_complete",
            "production_deployment": "not_performed",
            "original_files": {"checked": False, "reason": "source_checkout_not_configured"},
            "stages": {
                k: {key: v.get(key) for key in ("status", "elapsed_seconds", "report")}
                for k, v in self.journal.data["stages"].items()
            },
        }
        error = None
        try:
            summary["resources"] = resources(self.directory)
            summary["cleanup"] = cleanup_evidence(self.directory)
            summary["converter"] = self.converter
            require(
                summary["cleanup"]["complete"], "Owned process/container cleanup incomplete; see release-summary.json"
            )
            require(
                not self.converter or not self.converter.get("owned") or self.converter.get("detached"),
                "Owned converter mount retained; see release-summary.json",
            )
            if self.source:
                before = json.loads((self.directory / "original-files-before.json").read_text())
                after = protected_files(self.source)
                changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
                summary["original_files"] = {"checked": len(before), "changed": changed}
                require(not changed, "Protected originals changed during release; no automatic restoration performed")
            if completed and published:
                summary["synchronization"] = self.synchronize()
        except Exception as exc:
            summary["status"] = "finalization_incomplete"
            summary["error_type"] = type(exc).__name__
            error = exc
        finally:
            atomic_json(self.directory / "release-summary.json", summary)
            print(f"发布汇总：{self.directory / 'release-summary.json'}", flush=True)
        if error and completed:
            raise error
