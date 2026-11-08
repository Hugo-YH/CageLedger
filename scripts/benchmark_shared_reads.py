"""Compare scoped reads with a Git baseline using disposable synthetic data.

Run through the guarded verification runner, as with benchmark_performance.py.
Both revisions receive identical database bytes; business payloads must agree.
"""

import argparse
import hashlib
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def configure(source, directory):
    os.environ.update(
        CAGELEDGER_DATA_ROOT=str(directory),
        CAGELEDGER_DB=str(directory / "data.sqlite"),
        CAGELEDGER_IACUC_INDEX=str(directory / "index.json"),
        CAGELEDGER_PDF_CACHE=str(directory / "pdf-cache"),
        CAGELEDGER_EPHEMERAL_DB="1",
        CAGELEDGER_LOG_PERSISTENCE_ENABLED="0",
        CAGELEDGER_PERFORMANCE_HISTORY_ENABLED="0",
        PYTHONDONTWRITEBYTECODE="1",
    )
    sys.path.insert(0, str(source))


def seed(source, directory, count):
    configure(source, directory)
    # Reuse the public-card equivalence fixture; it contains no real records.
    from tests.test_shared_read_contexts import SharedReadContextTests

    fixture = SharedReadContextTests()
    fixture.setUp()
    try:
        for number in range(count):
            common = {"id": f"synthetic-{number}", "iacuc": f"Z{number + 1000}", "notes": "x" * 2000}
            fixture.put("experiment_applications", {**common, "pi": f"PI-{number}"})
            fixture.put("cage_slots", {**common, "rackId": "rack", "status": "active"})
            fixture.put("occupancies", {**common, "slotId": common["id"], "status": "active", "animalCount": 5})
            fixture.put(
                "placement_tasks",
                {**common, "sourceBatchId": common["id"], "cardSequence": 1, "status": "pending", "targetRoomId": "r"},
            )
            fixture.put(
                "intake_batches",
                {**common, "finalCardCount": 1, "status": "received", "roomName": "Room", "roomMatched": True},
            )
            fixture.conn.execute("INSERT INTO audit_logs VALUES ('synthetic', ?)", (json.dumps(common),))
        fixture.conn.commit()
        with sqlite3.connect(directory / "data.sqlite") as destination:
            fixture.conn.backup(destination)
    finally:
        fixture.doCleanups()


def stats(samples):
    ordered = sorted(samples)
    return {
        "medianMs": round(ordered[len(ordered) // 2], 3),
        "p95Ms": round(ordered[(len(ordered) * 95 + 99) // 100 - 1], 3),
    }


def rows_digest(conn):
    return hashlib.sha256("\n".join(conn.iterdump()).encode()).hexdigest()


def phase(source, directory, iterations):
    configure(source, directory)
    from server_app import cache, performance
    from server_app.db import ObservedConnection
    from server_app.domains.state.projections import public_cage_card_payload
    from server_app.domains.state.query import read_bootstrap_state
    from server_app.repositories.state import read_cached_state

    conn = sqlite3.connect(directory / "data.sqlite", factory=ObservedConnection)
    conn.row_factory = sqlite3.Row
    try:
        before = rows_digest(conn)
        performance.reset_performance_metrics()
        operations = {}
        for name, read in (
            ("publicCard", lambda: public_cage_card_payload(conn, "ABCD")),
            (
                "bootstrapSummary",
                lambda: read_bootstrap_state(conn, {"role": "admin"}, lambda c: read_cached_state(c, dict)),
            ),
        ):
            samples, payloads = [], []
            for _ in range(iterations):
                cache.invalidate_data_cache_prefixes("")
                started = time.perf_counter()
                payloads.append(read())
                samples.append((time.perf_counter() - started) * 1000)
            assert all(value == payloads[0] for value in payloads)
            encoded = json.dumps(payloads[0], sort_keys=True).encode()
            operations[name] = {**stats(samples), "payloadSha256": hashlib.sha256(encoded).hexdigest()}
        snapshot = performance.performance_snapshot()
        assert rows_digest(conn) == before, "Benchmark changed business or audit rows"
        return {"operations": operations, "performance": snapshot, "rowsPreserved": True}
    finally:
        conn.close()


def compare(baseline, output, records, iterations):
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    revision = subprocess.check_output(
        ["git", "rev-parse", "--verify", baseline + "^{commit}"], cwd=ROOT, text=True
    ).strip()
    with tempfile.TemporaryDirectory(prefix="cageledger-shared-benchmark-") as temporary:
        directory = Path(temporary)
        old_source, new_source = directory / "baseline", directory / "working"
        old_source.mkdir()
        archive = subprocess.check_output(["git", "archive", revision], cwd=ROOT)
        with tarfile.open(fileobj=io.BytesIO(archive)) as content:
            content.extractall(old_source, filter="data")
        new_source.mkdir()
        paths = (
            subprocess.check_output(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=ROOT)
            .decode()
            .split("\0")
        )
        for relative in filter(None, paths):
            path = ROOT / relative
            if path.is_file():
                target = new_source / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
        seed_directory = directory / "seed"
        seed_directory.mkdir()
        seed(new_source, seed_directory, records)
        results = {}
        for label, source in (("baseline", old_source), ("working", new_source)):
            runtime = directory / (label + "-runtime")
            runtime.mkdir()
            shutil.copy2(seed_directory / "data.sqlite", runtime / "data.sqlite")
            destination = output / (label + ".json")
            subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).resolve()),
                    "--phase",
                    "--source",
                    str(source),
                    "--runtime",
                    str(runtime),
                    "--iterations",
                    str(iterations),
                    "--output",
                    str(destination),
                ],
                check=True,
            )
            results[label] = json.loads(destination.read_text())
        for name in results["baseline"]["operations"]:
            assert (
                results["baseline"]["operations"][name]["payloadSha256"]
                == results["working"]["operations"][name]["payloadSha256"]
            ), name
        results.update(
            baselineRevision=revision,
            recordsPerTable=records,
            iterations=iterations,
            scope="Cold domain reads against identical synthetic databases; no network or NAS measurement",
        )
    results["temporaryDataRemoved"] = not directory.exists()
    (output / "comparison.json").write_text(json.dumps(results, indent=2) + "\n")
    print(
        json.dumps(
            {key: value["operations"] for key, value in results.items() if key in {"baseline", "working"}}, indent=2
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", default="v1.31.5")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--records", type=int, default=2000)
    parser.add_argument("--iterations", type=int, default=12)
    parser.add_argument("--phase", action="store_true")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--runtime", type=Path)
    args = parser.parse_args()
    if args.iterations < 1 or args.records < 0:
        parser.error("iterations must be positive and records nonnegative")
    if args.phase:
        args.output.write_text(json.dumps(phase(args.source, args.runtime, args.iterations), indent=2) + "\n")
    else:
        compare(args.baseline, args.output, args.records, args.iterations)
