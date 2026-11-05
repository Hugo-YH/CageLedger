"""Linux cgroup-v2 resource guard for managed development verification."""

import json
from datetime import UTC, datetime
from pathlib import Path

from release_host_guard import HostGuard


class LinuxTestGuard(HostGuard):
    """Keep the existing heartbeat, latched failure and evidence contract."""

    def __init__(self, output, *, cgroup=Path("/sys/fs/cgroup"), **kwargs):
        super().__init__(output, **kwargs)
        self.cgroup = Path(cgroup)
        self.baseline_events = None
        self.baseline_swap = None

    def check(self, admission=False):
        if self.reason:
            return False
        try:
            now = self.monotonic()
            if self.last_check is not None and now - self.last_check > 90:
                raise RuntimeError("host telemetry heartbeat expired")
            limit = int((self.cgroup / "memory.max").read_text().strip())
            used = int((self.cgroup / "memory.current").read_text().strip())
            statistics = dict(line.split() for line in (self.cgroup / "memory.stat").read_text().splitlines())
            inactive_file = int(statistics["inactive_file"])
            swap = int((self.cgroup / "memory.swap.current").read_text().strip())
            events = dict(line.split() for line in (self.cgroup / "memory.events").read_text().splitlines())
            events = {key: int(events[key]) for key in ("oom", "oom_kill", "max")}
            if limit <= 0 or min(used, inactive_file, swap) < 0 or any(value < 0 for value in events.values()):
                raise ValueError("Invalid cgroup metrics")
            # Like Docker's working-set metric, exclude reclaimable inactive file cache.
            # Image builds populate this cache without consuming application working memory.
            working = max(0, used - inactive_file)
            free = max(0, limit - working)
            if self.baseline_events is None:
                self.baseline_events = events
                self.baseline_swap = swap
            if any(events[key] > self.baseline_events[key] for key in ("oom", "oom_kill")):
                self.reason = "cgroup OOM event"
            elif free < max(1024**3, limit * (0.35 if admission else 0.20)):
                self.reason = "cgroup memory headroom insufficient"
            elif swap - self.baseline_swap > 512 * 1024**2:
                self.reason = "cgroup swap growth exceeded 512 MiB"
            self.last_check = now
            self.sample = {
                "at": datetime.now(UTC).isoformat(),
                "memory_limit_bytes": limit,
                "memory_used_bytes": used,
                "memory_working_bytes": working,
                "inactive_file_bytes": inactive_file,
                "swap_mib": swap / 1024**2,
                "events": events,
                "blocked": self.reason,
            }
            with (self.output / "host-processes.jsonl").open("a") as stream:
                stream.write(json.dumps(self.sample) + "\n")
        except RuntimeError as error:
            self.reason = str(error)
        except Exception:
            self.reason = "Linux cgroup-v2 telemetry unavailable"
        self._write_permit(self.admitted and not self.reason, self.reason)
        return not self.reason
