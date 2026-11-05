"""Reuse completed local checks by source content, selected command and tool inputs."""

import json
import re
import shutil
import sys
import sysconfig
from pathlib import Path

from release_runtime import atomic_json, command, digest, hashed, source_fingerprint
from validation_inputs import metadata


def kind(job):
    if job[:3] == ["npm", "run", "check:steps"]:
        return "check"
    if job[:3] == ["npm", "run", "check:quality"]:
        return "quality"
    if any("vitest.mjs" in part for part in job):
        return "frontend-unit"
    if "scripts/run_python_tests.py" in job or ("unittest" in job and "discover" in job):
        return "backend-unit"
    # Browser reports and build artifacts have their own evidence, not a generic exit-code cache.
    return None


def inputs(repo, job, environment):
    category = kind(job)
    if category is None:
        return None
    tools = {}
    if category in {"frontend-unit", "check", "quality"}:
        node = json.loads(
            command(["node", "-p", "JSON.stringify({version:process.version,path:process.execPath})"], repo)
        )
        tools["node"] = {**node, "sha256": digest(node["path"])}
        tools["npm_install"] = digest(repo / "node_modules/.package-lock.json")
    if category in {"backend-unit", "check", "quality"}:
        tools["python"] = {"version": sys.version, "sha256": digest(Path(sys.executable).resolve())}
        tools["python_install"] = metadata(sysconfig.get_path("purelib"))
    if category in {"backend-unit", "check"}:
        converter = environment.get("CAGELEDGER_LIBREOFFICE_BIN")
        if converter:
            path = Path(converter).resolve()
            tools["writer"] = metadata(path.parent)
        browser = environment.get("CAGELEDGER_CHROMIUM_BIN") or shutil.which("chromium")
        if browser:
            tools["pdf_browser"] = metadata(Path(browser).resolve().parent)
    return hashed(
        {
            "schema": 1,
            "source": source_fingerprint(repo),
            "command": job,
            "kind": category,
            "tools": tools,
            "environment": {key: environment.get(key, "") for key in ("TZ", "LANG", "LC_ALL", "NODE_OPTIONS")},
        }
    )


def cache_key(repo, job, environment):
    try:
        return inputs(repo, job, environment)
    except (OSError, ValueError, RuntimeError):
        # An unavailable cache input never replaces the actual check or its normal preflight.
        return None


def test_evidence(job, log):
    text = re.sub(r"\x1b\[[0-9;]*m", "", log.read_text(errors="replace"))
    if re.search(r"\bRan 0 tests?\b", text):
        raise RuntimeError("检查实际执行了零个 Python 用例，不能记录成功。")
    category = kind(job)
    if category == "quality":
        return bool(text.strip())
    if re.search(r"\b(?:skipped|flaky)\b", text, re.IGNORECASE):
        return False
    python = re.search(r"\bRan ([1-9][0-9]*) tests?\b", text)
    frontend = re.search(r"\bTests\s+[1-9][0-9]*\s+passed\b", text)
    return bool(python and frontend) if category == "check" else bool(python or frontend)


def lookup(directory, key, job):
    if key is None:
        return None
    path = directory / (key + ".json")
    try:
        value = json.loads(path.read_text())
        log = Path(value["log"])
        if (
            value.get("schema") == 1
            and value.get("status") == "passed"
            and value.get("exit_code") == 0
            and value.get("fingerprint") == key
            and value.get("command") == job
            and log.is_file()
            and not log.is_symlink()
            and value.get("log_sha256") == digest(log)
            and test_evidence(job, log)
        ):
            return value
    except (OSError, ValueError, KeyError, TypeError, RuntimeError):
        pass
    return None


def remember(directory, key, job, log):
    if key is not None and test_evidence(job, log):
        atomic_json(
            directory / (key + ".json"),
            {
                "schema": 1,
                "status": "passed",
                "exit_code": 0,
                "fingerprint": key,
                "command": job,
                "log": str(log.resolve()),
                "log_sha256": digest(log),
            },
        )
