"""Read-only macOS release admission and resource telemetry; never signals processes.

CPU percentages from ps are per logical core. Background CPU is advisory only.
RSS attribution excludes compressed/swapped memory and is not total footprint.
"""

import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

SERVICES = ("com.apple.trustd.agent", "com.apple.cfprefsd.xpc.agent", "com.apple.TrustedPeersHelper")
PREDICATE = (
    '(process == "launchd" AND eventMessage CONTAINS[c] "OS_REASON_JETSAM") '
    'OR (process == "kernel" AND eventMessage CONTAINS[c] "low-swap")'
)


def execute(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=15)


def process_rows(raw):
    """Parse executable names, never arguments, from ps comm telemetry."""
    rows = []
    for line in raw.splitlines():
        values = line.split(None, 10)
        if len(values) != 11:
            raise ValueError("Incomplete process telemetry")
        rows.append(
            {
                "pid": int(values[0]),
                "ppid": int(values[1]),
                "pgid": int(values[2]),
                "rss_kib": int(values[3]),
                "cpu": float(values[4]),
                "identity": " ".join(values[5:10]),
                "name": Path(values[10]).name,
            }
        )
    if not rows:
        raise ValueError("Empty process telemetry")
    return rows


def service_rows(raw):
    result = {}
    for line in raw.splitlines():
        values = line.split()
        if len(values) == 3 and values[2] in SERVICES:
            # Historical launchctl exit status (including -9) is not a new failure.
            result[values[2]] = int(values[0]) if values[0].isdigit() else None
    if set(result) != set(SERVICES):
        raise ValueError("Critical service telemetry unavailable")
    return result


def event_keys(raw):
    if any(marker in raw.lower() for marker in ("error:", "not permitted", "permission denied")):
        raise ValueError("System event telemetry unavailable")
    return {
        hashlib.sha256(line.encode()).hexdigest()
        for line in raw.splitlines()
        if ("OS_REASON_JETSAM" in line or "low-swap" in line) and re.match(r"^\d{4}-", line)
    }


class Policy:
    """Deterministic, latched protection policy independent of command execution."""

    def __init__(self, cpus):
        self.cpus = max(1, cpus)
        self.seen = set()
        self.previous_services = {}
        self.changes = []
        self.high_load = 0
        self.low = 0
        self.baseline_swap = None
        self.reason = ""

    def assess(self, sample, keys, now, admission=False):
        fresh = keys - self.seen
        self.seen.update(keys)
        reasons = []
        if sample["pressure_level"] != 1:
            self.reason = self.reason or "macOS memory pressure warning/critical"
            return False, len(fresh)
        if fresh:
            reasons.append("new Jetsam/low-swap events")
        current = sample["services"]
        changed = [
            name
            for name, pid in current.items()
            if pid is not None and self.previous_services.get(name) is not None and self.previous_services[name] != pid
        ]
        self.previous_services.update({name: pid for name, pid in current.items() if pid is not None})
        self.changes.extend((now, name) for name in changed)
        self.changes = [(at, name) for at, name in self.changes if now - at <= 60]
        if (
            len({name for _, name in self.changes}) >= 2
            or any(sum(name == service for _, name in self.changes) >= 2 for service in SERVICES)
            or (admission and changed)
        ):
            reasons.append("critical service PID turnover")
        self.high_load = self.high_load + 1 if sample["load1"] > self.cpus * 1.5 else 0
        if sample["load1"] > self.cpus * 3 or self.high_load >= 3:
            reasons.append("abnormal sustained system load")
        self.low = self.low + 1 if sample["free_percent"] < 30 else 0
        if self.baseline_swap is None:
            self.baseline_swap = sample["swap_mib"]
        if sample["free_percent"] < 20 or self.low >= 2 or sample["swap_mib"] - self.baseline_swap > 512:
            reasons.append("memory/swap resource guard")
        if admission and (sample["free_percent"] < 35 or sample["load1"] > self.cpus):
            reasons.append("host not ready for admission")
        if reasons and not self.reason:
            self.reason = "; ".join(reasons)
        return not self.reason, len(fresh)


class HostGuard:
    """Fail closed on unavailable telemetry, including unsupported operating systems.

    admit() observes seven samples over at least sixty seconds. check() returns
    safety, not admission: a caller must admit before starting its first job.
    Failure is latched for this instance; start a new admission after diagnosis.
    All methods return booleans and expose sanitized reason/sample attributes.
    """

    def __init__(self, output, *, collector=None, monotonic=None, sleep=None, cpus=None):
        self.output = Path(output)
        self.output.mkdir(parents=True, exist_ok=True)
        self.policy = Policy(cpus or os.cpu_count() or 1)
        self.reason = ""
        self.sample = {}
        self.admitted = False
        self.collector = collector or self._collect
        self.monotonic = monotonic or time.monotonic
        self.sleep = sleep or time.sleep
        self.last_check = None
        self.last_log_check = None
        self.permit = self.output / "host-permit.json"
        self._write_permit(False, "admission pending")

    def _write_permit(self, allowed, reason=""):
        temporary = self.permit.with_suffix(".tmp")
        temporary.write_text(json.dumps({"allowed": allowed, "checked_at": time.time(), "reason": reason}) + "\n")
        temporary.replace(self.permit)

    def _collect(self, admission):
        if sys.platform != "darwin":
            raise RuntimeError("Unsupported host telemetry")
        now = self.monotonic()
        pressure = int(execute(["sysctl", "-n", "kern.memorystatus_vm_pressure_level"]).strip())
        if pressure not in (1, 2, 4):
            raise ValueError("Unknown memory pressure level")
        if pressure != 1:
            # Stop before slower queries; uncollected metrics remain absent rather
            # than inventing free-memory, swap or service readings.
            return {
                "at": datetime.now(UTC).isoformat(),
                "pressure_level": pressure,
            }, set()
        rows = process_rows(execute(["ps", "-axo", "pid=,ppid=,pgid=,rss=,%cpu=,lstart=,comm="]))
        services = service_rows(execute(["launchctl", "list"]))
        free = re.search(r"System-wide memory free percentage:\s*(\d+)%", execute(["memory_pressure", "-Q"]))
        swap = re.search(r"used\s*=\s*([\d.]+)([KMG])", execute(["sysctl", "-n", "vm.swapusage"]))
        if free is None or swap is None:
            raise ValueError("Memory telemetry unavailable")
        keys = set()
        if self.last_log_check is None or now - self.last_log_check >= 15 or admission:
            # Rolling overlap keeps repeated scans bounded while avoiding boundary gaps.
            start = (datetime.now() - timedelta(seconds=120)).strftime("%Y-%m-%d %H:%M:%S")
            keys = event_keys(
                execute(["/usr/bin/log", "show", "--start", start, "--style", "compact", "--predicate", PREDICATE])
            )
            self.last_log_check = now
        return {
            "at": datetime.now(UTC).isoformat(),
            "load1": os.getloadavg()[0],
            "pressure_level": pressure,
            "free_percent": int(free[1]),
            "swap_mib": float(swap[1]) * {"K": 1 / 1024, "M": 1, "G": 1024}[swap[2]],
            "services": services,
            "background_cpu": sum(row["cpu"] for row in rows if row["name"] in ("backupd", "mediaanalysisd")),
            "processes": rows,
            "memory_metric": "RSS KiB; excludes compressed/swapped memory; not total footprint",
        }, keys

    def check(self, admission=False):
        if self.reason:
            return False
        try:
            now = self.monotonic()
            if self.last_check is not None and now - self.last_check > 90:
                self.reason = "host telemetry heartbeat expired"
                self._write_permit(False, self.reason)
                return False
            sample, keys = self.collector(admission)
            if sample["pressure_level"] not in (1, 2, 4):
                raise ValueError("Invalid pressure metric")
            if sample["pressure_level"] == 1:
                required = ("load1", "free_percent", "swap_mib", "services")
                if any(key not in sample for key in required) or set(sample["services"]) != set(SERVICES):
                    raise ValueError("Incomplete sample")
                metrics = (sample["load1"], sample["free_percent"], sample["swap_mib"])
                if any(not math.isfinite(value) or value < 0 for value in metrics) or sample["free_percent"] > 100:
                    raise ValueError("Invalid resource metric")
            safe, count = self.policy.assess(sample, keys, now, admission)
            self.reason = self.policy.reason
            self.last_check = self.monotonic()
            sample.update(
                new_system_events=count,
                blocked=self.reason,
                background_cpu_advisory=sample.get("background_cpu", 0) >= 50,
            )
            self.sample = sample
            with (self.output / "host-processes.jsonl").open("a") as stream:
                stream.write(json.dumps(sample) + "\n")
            self._write_permit(self.admitted and safe, self.reason)
            return safe
        except Exception:
            # No command output, environments, paths or log messages in error reports.
            self.reason = self.reason or "host telemetry unavailable"
            try:
                self._write_permit(False, self.reason)
            except OSError:
                pass
            return False

    def admit(self):
        started = self.monotonic()
        swaps = []
        for index in range(7):
            if not self.check(admission=True):
                return False
            swaps.append(self.sample["swap_mib"])
            if index < 6:
                self.sleep(10)
        if self.monotonic() - started < 60 or max(swaps) - min(swaps) > 64:
            self.reason = "host admission interval or swap stability failed"
            self._write_permit(False, self.reason)
            return False
        self.admitted = True
        self._write_permit(True)
        return True
