import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from linux_test_guard import LinuxTestGuard


class LinuxTestGuardTests(unittest.TestCase):
    def test_memory_pressure_and_failure_latch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, value in {
                "memory.max": str(8 * 1024**3),
                "memory.current": "0",
                "memory.stat": "inactive_file 0\n",
                "memory.swap.current": "0",
                "memory.events": "oom 0\noom_kill 0\nmax 0\n",
            }.items():
                (root / name).write_text(value)
            guard = LinuxTestGuard(root / "logs", cgroup=root)
            self.assertTrue(guard.check(admission=True))
            (root / "memory.current").write_text(str(7 * 1024**3))
            self.assertFalse(guard.check())
            (root / "memory.current").write_text("0")
            self.assertFalse(guard.check())

    def test_missing_telemetry_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            guard = LinuxTestGuard(Path(directory) / "logs", cgroup=Path(directory))
            self.assertFalse(guard.check())

    def test_new_oom_event_blocks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, value in {
                "memory.max": str(8 * 1024**3),
                "memory.current": "0",
                "memory.stat": "inactive_file 0\n",
                "memory.swap.current": "0",
                "memory.events": "oom 2\noom_kill 1\nmax 3\n",
            }.items():
                (root / name).write_text(value)
            guard = LinuxTestGuard(root / "logs", cgroup=root)
            self.assertTrue(guard.check())
            (root / "memory.events").write_text("oom 3\noom_kill 2\nmax 4\n")
            self.assertFalse(guard.check())

    def test_reclaimable_build_cache_is_not_an_oom(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, value in {
                "memory.max": str(8 * 1024**3),
                "memory.current": str(8 * 1024**3),
                "memory.stat": f"inactive_file {6 * 1024**3}\n",
                "memory.swap.current": "0",
                "memory.events": "oom 0\noom_kill 0\nmax 10\n",
            }.items():
                (root / name).write_text(value)
            guard = LinuxTestGuard(root / "logs", cgroup=root)
            self.assertTrue(guard.check(admission=True))
            (root / "memory.events").write_text("oom 0\noom_kill 0\nmax 11\n")
            self.assertTrue(guard.check())
            (root / "memory.stat").write_text("inactive_file 0\n")
            self.assertFalse(guard.check())
