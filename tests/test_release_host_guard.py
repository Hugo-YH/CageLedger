import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "scripts/release_host_guard.py"
spec = importlib.util.spec_from_file_location("release_host_guard", MODULE)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def healthy():
    return {
        "load1": 2.0,
        "free_percent": 70,
        "pressure_level": 1,
        "swap_mib": 1000,
        "services": dict(zip(guard.SERVICES, (10, 20, 30), strict=True)),
        "background_cpu": 0,
    }


class Clock:
    def __init__(self):
        self.now = 0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class HostPolicyTests(unittest.TestCase):
    def test_background_cpu_alone_never_blocks(self):
        policy = guard.Policy(10)
        sample = healthy()
        sample["background_cpu"] = 950
        for now in range(0, 120, 10):
            self.assertTrue(policy.assess(sample, set(), now, admission=True)[0])

    def test_jetsam_blocks_and_latches(self):
        policy = guard.Policy(10)
        self.assertEqual(policy.assess(healthy(), {"new-event"}, 0), (False, 1))
        self.assertEqual(policy.assess(healthy(), {"new-event"}, 10), (False, 0))
        self.assertFalse(policy.assess(healthy(), set(), 20)[0])

    def test_low_memory_requires_consecutive_samples(self):
        policy = guard.Policy(10)
        sample = healthy()
        sample["free_percent"] = 24
        self.assertTrue(policy.assess(sample, set(), 0)[0])
        self.assertTrue(policy.assess(healthy(), set(), 20)[0])
        self.assertTrue(policy.assess(sample, set(), 30)[0])
        self.assertFalse(policy.assess(sample, set(), 40)[0])

    def test_swap_growth_blocks_even_with_good_free_memory(self):
        policy = guard.Policy(10)
        self.assertTrue(policy.assess(healthy(), set(), 0)[0])
        sample = healthy()
        sample["swap_mib"] += 513
        self.assertFalse(policy.assess(sample, set(), 10)[0])

    def test_pressure_warning_and_critical_stop_immediately_and_latch(self):
        for level in (2, 4):
            policy = guard.Policy(10)
            self.assertTrue(policy.assess(healthy(), set(), 0)[0])
            self.assertFalse(policy.assess({**healthy(), "pressure_level": level}, set(), 5)[0])
            self.assertFalse(policy.assess(healthy(), set(), 10)[0])

    def test_very_low_memory_stops_on_first_sample(self):
        policy = guard.Policy(10)
        self.assertFalse(policy.assess({**healthy(), "free_percent": 19}, set(), 0)[0])

    def test_load_spike_and_sustained_load(self):
        for load, count in ((41, 1), (21, 3)):
            with self.subTest(load=load):
                policy = guard.Policy(10)
                sample = healthy()
                sample["load1"] = load
                for index in range(count - 1):
                    self.assertTrue(policy.assess(sample, set(), index * 10)[0])
                self.assertFalse(policy.assess(sample, set(), 30)[0])

    def test_single_restart_tolerated_runtime_but_not_admission(self):
        for admission, safe in ((False, True), (True, False)):
            policy = guard.Policy(10)
            sample = healthy()
            policy.assess(sample, set(), 0, admission)
            sample["services"][guard.SERVICES[0]] = 99
            self.assertEqual(policy.assess(sample, set(), 10, admission)[0], safe)

    def test_two_distinct_or_repeated_restarts_block(self):
        for second in (guard.SERVICES[0], guard.SERVICES[1]):
            policy = guard.Policy(10)
            sample = healthy()
            policy.assess(sample, set(), 0)
            sample["services"][guard.SERVICES[0]] = 99
            self.assertTrue(policy.assess(sample, set(), 10)[0])
            sample["services"][second] = 100
            self.assertFalse(policy.assess(sample, set(), 20)[0])

    def test_old_restart_expires(self):
        policy = guard.Policy(10)
        sample = healthy()
        policy.assess(sample, set(), 0)
        sample["services"][guard.SERVICES[0]] = 99
        policy.assess(sample, set(), 10)
        sample["services"][guard.SERVICES[1]] = 100
        self.assertTrue(policy.assess(sample, set(), 80)[0])

    def test_admission_resource_thresholds(self):
        for key, value in (("load1", 11), ("free_percent", 34)):
            policy = guard.Policy(10)
            sample = healthy()
            sample[key] = value
            self.assertFalse(policy.assess(sample, set(), 0, admission=True)[0])


class HostGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.clock = Clock()
        self.input = healthy()
        self.keys = set()
        self.monitor = guard.HostGuard(
            self.tmp.name,
            collector=lambda _admission: (copy.deepcopy(self.input), self.keys),
            monotonic=self.clock,
            sleep=self.clock.sleep,
            cpus=10,
        )

    def permit(self):
        return json.loads(self.monitor.permit.read_text())

    def test_success_requires_full_admission_then_runtime_stays_allowed(self):
        self.assertFalse(self.permit()["allowed"])
        self.assertTrue(self.monitor.check())
        self.assertFalse(self.permit()["allowed"])
        self.input["background_cpu"] = 100
        self.assertTrue(self.monitor.admit())
        self.assertGreaterEqual(self.clock.now, 60)
        self.assertTrue(self.permit()["allowed"])
        self.assertTrue(self.monitor.sample["background_cpu_advisory"])
        self.assertTrue(self.monitor.check())
        self.assertTrue(self.permit()["allowed"])

    def test_event_during_admission_stops_without_full_wait(self):
        self.keys = {"recent-jetsam"}
        self.assertFalse(self.monitor.admit())
        self.assertEqual(self.clock.now, 0)
        self.assertFalse(self.permit()["allowed"])

    def test_runtime_event_revokes_permission(self):
        self.assertTrue(self.monitor.admit())
        self.keys = {"jetsam"}
        self.assertFalse(self.monitor.check())
        self.assertFalse(self.permit()["allowed"])
        self.keys = set()
        self.assertFalse(self.monitor.check())

    def test_failed_or_missing_telemetry_never_leaks_details(self):
        for collector in (
            lambda _: ({}, set()),
            lambda _: ({**healthy(), "load1": float("nan")}, set()),
            lambda _: ({**healthy(), "swap_mib": -1}, set()),
            lambda _: (_ for _ in ()).throw(RuntimeError("private-token-unified-log-content")),
        ):
            with self.subTest(collector=collector):
                monitor = guard.HostGuard(self.tmp.name, collector=collector)
                self.assertFalse(monitor.check())
                self.assertEqual(monitor.reason, "host telemetry unavailable")
                self.assertNotIn("private-token", monitor.permit.read_text())

    def test_missed_heartbeat_blocks_without_unobserved_event_gap(self):
        self.assertTrue(self.monitor.admit())
        self.clock.now += 91
        self.assertFalse(self.monitor.check())
        self.assertIn("heartbeat", self.monitor.reason)
        self.assertFalse(self.permit()["allowed"])

    def test_unstable_admission_swap_blocks_below_runtime_limit(self):
        def sample(_):
            value = healthy()
            value["swap_mib"] += self.clock.now * 2
            return value, set()

        self.monitor.collector = sample
        self.assertFalse(self.monitor.admit())
        self.assertIn("swap stability", self.monitor.reason)
        self.assertFalse(self.permit()["allowed"])

    def test_shortened_admission_clock_is_rejected(self):
        self.monitor.sleep = lambda _: None
        self.assertFalse(self.monitor.admit())
        self.assertFalse(self.permit()["allowed"])

    def test_unsupported_platform_is_fail_closed(self):
        monitor = guard.HostGuard(self.tmp.name)
        with patch.object(guard.sys, "platform", "linux"), patch.object(guard, "execute") as execute:
            self.assertFalse(monitor.admit())
            execute.assert_not_called()
        self.assertFalse(self.permit()["allowed"])


class TelemetryParsingTests(unittest.TestCase):
    def test_pressure_fast_path_does_not_wait_for_slow_system_logs(self):
        with tempfile.TemporaryDirectory() as directory:
            monitor = guard.HostGuard(directory)
            with patch.object(guard.sys, "platform", "darwin"), patch.object(guard, "execute", return_value="2") as run:
                self.assertFalse(monitor.check())
            run.assert_called_once_with(["sysctl", "-n", "kern.memorystatus_vm_pressure_level"])
            self.assertIn("memory pressure", monitor.reason)

    def test_processes_keep_basename_and_identity_without_arguments(self):
        rows = guard.process_rows("17 1 17 1024 99.0 Tue Nov 3 14:00:00 2026 /System/Library/Media Analysis")
        self.assertEqual(rows[0]["name"], "Media Analysis")
        self.assertEqual(rows[0]["identity"], "Tue Nov 3 14:00:00 2026")
        self.assertNotIn("/System", json.dumps(rows))
        for raw in ("", "17 incomplete"):
            with self.assertRaises(ValueError):
                guard.process_rows(raw)

    def test_historical_exit_status_not_treated_as_new_event(self):
        raw = "\n".join(f"{pid} -9 {name}" for pid, name in zip(("10", "-", "30"), guard.SERVICES, strict=True))
        self.assertEqual(guard.service_rows(raw)[guard.SERVICES[0]], 10)
        self.assertIsNone(guard.service_rows(raw)[guard.SERVICES[1]])
        with self.assertRaises(ValueError):
            guard.service_rows("")

    def test_events_are_deduplicated_hashes_not_raw_logs(self):
        raw = "2026-11-03 14:00:00 kernel low-swap private-details"
        keys = guard.event_keys(raw + "\n" + raw)
        self.assertEqual(len(keys), 1)
        self.assertEqual(len(next(iter(keys))), 64)
        self.assertNotIn("private", str(keys))
        for raw in ("Error: private text", "Operation not permitted", "Permission denied"):
            with self.assertRaises(ValueError):
                guard.event_keys(raw)

    def test_collect_uses_comm_and_rolling_logs_without_sensitive_arguments(self):
        calls = []
        rows = "17 1 17 1024 99.0 Tue Nov 3 14:00:00 2026 /System/mediaanalysisd"
        services = "\n".join(f"10 0 {name}" for name in guard.SERVICES)

        def execute(args):
            calls.append(args)
            if args == ["sysctl", "-n", "kern.memorystatus_vm_pressure_level"]:
                return "1"
            return {
                "ps": rows,
                "launchctl": services,
                "memory_pressure": "System-wide memory free percentage: 75%",
                "sysctl": "total = 2048.00M used = 1.50G free = 512.00M",
                "/usr/bin/log": "Timestamp Type Process Message",
            }[args[0]]

        with tempfile.TemporaryDirectory() as tmp:
            monitor = guard.HostGuard(tmp)
            with (
                patch.object(guard.sys, "platform", "darwin"),
                patch.object(guard, "execute", execute),
                patch.object(guard.os, "getloadavg", return_value=(2.0, 2.0, 2.0)),
            ):
                self.assertTrue(monitor.check())
            self.assertEqual(monitor.sample["swap_mib"], 1536)
            self.assertEqual(monitor.sample["background_cpu"], 99)
            self.assertTrue(monitor.sample["background_cpu_advisory"])
        self.assertEqual(calls[0], ["sysctl", "-n", "kern.memorystatus_vm_pressure_level"])
        self.assertEqual(calls[1], ["ps", "-axo", "pid=,ppid=,pgid=,rss=,%cpu=,lstart=,comm="])
        self.assertIn("--start", calls[-1])


if __name__ == "__main__":
    unittest.main()
