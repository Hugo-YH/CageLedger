"""Resource-managed checks; focused commands require explicit targets, never all-test fallback."""

import argparse
import json
import signal
import subprocess
import sys
from contextlib import nullcontext
from datetime import UTC, datetime
from uuid import uuid4

from release_host_guard import HostGuard
from release_runtime import ROOT, Runner, atomic_json, isolation_environment, require
from release_tools import release_converter
from verification_host import host_task_lock

MODES = ("check", "full", "all-unit", "all-python", "e2e", "compat", "unit", "related", "python")


def commands(mode, targets, grep=None):
    explicit = mode in {"unit", "related", "python"}
    focused = explicit or (mode in {"all-unit", "all-python"} and bool(targets))
    require(not explicit or targets, "针对性测试必须提供文件/模块；缺少目标时不会退回全量测试。")
    require(not targets or focused or mode in {"e2e", "compat"}, "此模式不接受测试文件参数")
    require(all(not target.startswith("-") for target in targets), "请传入明确测试文件或模块，不接受资源参数覆盖。")
    require(not grep or mode in {"unit", "related", "e2e", "compat"}, "此模式不支持 --grep")
    if mode in {"unit", "related", "all-unit"}:
        return [
            [
                "node",
                "node_modules/vitest/vitest.mjs",
                "related" if mode == "related" else "run",
                *(["--run"] if mode == "related" else []),
                *targets,
                "--maxWorkers=1",
                "--passWithNoTests=false",
                *(["--testNamePattern", grep] if grep else []),
            ]
        ]
    if mode in {"python", "all-python"}:
        if focused:
            return [[sys.executable, "scripts/run_python_tests.py", *targets]]
        return [
            [
                sys.executable,
                "-m",
                "unittest",
                *(targets if focused else ["discover", "-s", "tests", "-p", "test_*.py"]),
            ]
        ]
    e2e = [
        "node",
        "node_modules/@playwright/test/cli.js",
        "test",
        *targets,
        "--workers=1",
        "--retries=0",
        *(["--grep", grep] if grep else []),
    ]
    compat = [
        "node",
        "scripts/test_desktop_compat.mjs",
        *targets,
        "--workers=1",
        "--retries=0",
        *(["--grep", grep] if grep else []),
    ]
    if mode == "e2e":
        return [e2e]
    if mode == "compat":
        return [compat]
    check = ["npm", "run", "check:steps"]
    return [check] if mode == "check" else [check, ["npm", "run", "build"], e2e, compat]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=MODES)
    parser.add_argument("targets", nargs="*")
    parser.add_argument("--grep")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    jobs = commands(args.mode, args.targets, args.grep)
    if args.dry_run:
        print(json.dumps(jobs, ensure_ascii=False, indent=2))
        return
    directory = (
        ROOT.parent
        / (ROOT.name + "-verify-state")
        / (datetime.now(UTC).strftime("%Y%m%dT%H%M%S") + "-" + uuid4().hex[:8])
    )
    converter = release_converter(ROOT) if args.mode in {"check", "full"} else nullcontext()
    with host_task_lock(), converter:
        guard = HostGuard(directory / "host")
        runner = Runner(ROOT, guard)
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda _s, _f: runner.stopping.set())
        # Focused unit/API checks still take the host lock and monitor pressure;
        # browser/full suites require the longer stable admission observation.
        focused = args.mode in {"unit", "related", "python"} or (
            args.mode in {"all-unit", "all-python"} and bool(args.targets)
        )
        require(guard.check(admission=True) if focused else guard.admit(), guard.reason)
        environment = isolation_environment()
        environment["NODE_OPTIONS"] = "--max-old-space-size=3072"
        environment["CAGELEDGER_E2E_OUTPUT_DIR"] = str(directory / "chromium")
        environment["CAGELEDGER_COMPAT_OUTPUT_DIR"] = str(directory / "compat")
        results = []
        print(f"验证范围：{args.mode}；证据目录：{directory}", flush=True)
        try:
            for index, job in enumerate(jobs):
                entry = {"command": job, "status": "running", "started": datetime.now(UTC).isoformat()}
                results.append(entry)
                try:
                    runner.run(job, directory / f"step-{index + 1}" / "command.log", env=environment)
                    entry["status"] = "passed"
                except BaseException:
                    entry["status"] = "failed"
                    raise
                finally:
                    entry["ended"] = datetime.now(UTC).isoformat()
        finally:
            atomic_json(directory / "results.json", {"scope": args.mode, "targets": args.targets, "steps": results})
        print("所选检查完成；此结果不等同于发布交付凭据。", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from error
