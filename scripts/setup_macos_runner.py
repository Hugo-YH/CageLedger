"""Prepare a verified native Gitea Runner and a per-user launchd service on Apple Silicon."""

import argparse
import hashlib
import json
import os
import platform
import plistlib
import sys
import tempfile
import urllib.request
from pathlib import Path

VERSION = "5.3.0"
ASSET = f"gitea-runner-{VERSION}-darwin-arm64"
URL = f"https://gitea.com/gitea/runner/releases/download/v{VERSION}/{ASSET}"
# Published in the official release's checksums.txt; never substitute a failed download's hash.
SHA256 = "bb4f00a306b38ebdd177ac9b6ee59f0ea5bdb40a87255eaca3d5cdcc7492196d"
LABEL = "us.cellnucle.cageledger.runner"


def install_binary(root):
    target = root / "gitea-runner"
    if target.exists():
        with target.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != SHA256:
                raise ValueError(
                    "Existing runner differs from the pinned release; preserve it and choose another --root."
                )
        return target
    with tempfile.TemporaryDirectory(dir=root) as temporary:
        downloaded = Path(temporary) / ASSET
        with urllib.request.urlopen(URL, timeout=60) as response, downloaded.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        with downloaded.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != SHA256:
                raise ValueError("Runner SHA256 verification failed; no binary installed.")
        downloaded.chmod(0o755)
        os.replace(downloaded, target)
    return target


def prepare_files(root, home, executable):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    logs = root / "logs"
    logs.mkdir(exist_ok=True)
    (root / "work").mkdir(exist_ok=True)
    path = ":".join(
        [
            "/opt/homebrew/opt/node@22/bin",
            "/opt/homebrew/opt/python@3.13/libexec/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
    )
    config = root / "config.yaml"
    if not config.exists():
        with config.open("x", encoding="utf-8") as output:
            output.write(
                "log:\n  level: info\nrunner:\n"
                f"  file: {json.dumps(str(root / '.runner'))}\n"
                "  capacity: 1\n  timeout: 3h\n  labels:\n    - macos-arm64:host\n"
                f"  envs:\n    PATH: {json.dumps(path)}\nhost:\n"
                f"  workdir_parent: {json.dumps(str(root / 'work'))}\n"
            )
        config.chmod(0o600)
    agents = home / "Library" / "LaunchAgents"
    agents.mkdir(parents=True, exist_ok=True)
    service = agents / f"{LABEL}.plist"
    if not service.exists():
        with service.open("xb") as output:
            plistlib.dump(
                {
                    "Label": LABEL,
                    "ProgramArguments": [str(executable), "-c", str(config), "daemon"],
                    "WorkingDirectory": str(root),
                    "EnvironmentVariables": {"PATH": path},
                    "RunAtLoad": True,
                    "KeepAlive": True,
                    "ThrottleInterval": 10,
                    "StandardOutPath": str(logs / "runner.out.log"),
                    "StandardErrorPath": str(logs / "runner.err.log"),
                },
                output,
            )
    return config, service


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path)
    arguments = parser.parse_args()
    if sys.platform != "darwin" or platform.machine().lower() not in {"arm64", "aarch64"}:
        parser.error("Run this installer on an Apple Silicon Mac, not inside a Linux container.")
    home = Path.home()
    root = (arguments.root or home / "Library/Application Support/CageLedgerRunner").expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    executable = install_binary(root)
    config, service = prepare_files(root, home, executable)
    print(f"Verified Gitea Runner {VERSION}: {executable}")
    print(f"Configuration (existing files preserved): {config}")
    print(f"Prepared launchd service (not started): {service}")
    print("Next: register interactively with a repository runner registration token, then start the daemon.")


if __name__ == "__main__":
    main()
