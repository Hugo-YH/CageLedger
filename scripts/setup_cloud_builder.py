#!/usr/bin/env python3
"""Create a local cloud BuildKit builder and verify its bundled ARM64 emulator."""

import argparse
import csv
import io
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

SOCKET = "unix:///var/run/docker.sock"
BUILDKIT_IMAGE = "moby/buildkit@sha256:c5f8862f52499773af85bc07695b2379ef08e8002352b0df2c4864c91d78dabe"
PROBE_IMAGE = "busybox:1.37@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec"


def docker_environment():
    environment = dict(os.environ)
    for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"):
        environment.pop(key, None)
    return environment


def docker(*arguments, capture=False):
    return subprocess.run(
        ["docker", f"--host={SOCKET}", *arguments],
        env=docker_environment(),
        capture_output=capture,
        text=True,
        check=False,
    )


def driver_option(value):
    # Buildx parses every --driver-opt as CSV, including NO_PROXY's commas.
    stream = io.StringIO()
    csv.writer(stream, lineterminator="").writerow([value])
    return stream.getvalue()


def configured_proxies():
    config_directory = Path(os.environ.get("DOCKER_CONFIG", str(Path.home() / ".docker")))
    path = config_directory / "config.json"
    configuration = json.loads(path.read_text()) if path.exists() else {}
    proxies = configuration.get("proxies", {})
    return proxies.get(SOCKET, proxies.get("default", {}))


def ensure_builder(name):
    existing = docker("buildx", "inspect", name, capture=True)
    if existing.returncode == 0:
        driver = re.search(r"^Driver:\s+(\S+)", existing.stdout, re.MULTILINE)
        endpoints = re.findall(r"^Endpoint:\s+(\S+)", existing.stdout, re.MULTILINE)
        if not driver or driver.group(1) != "docker-container" or endpoints != [SOCKET]:
            raise RuntimeError("The builder name is already used by another configuration; choose --name.")
    else:
        with tempfile.TemporaryDirectory(prefix="cageledger-buildkit-config-") as directory:
            config = Path(directory) / "buildkitd.toml"
            bundle = Path(os.environ.get("CAGELEDGER_BUILD_CA_BUNDLE", "/etc/ssl/certs/ca-certificates.crt")).resolve()
            if not bundle.is_file():
                raise RuntimeError("The configured CA bundle is missing.")
            config.write_text('[registry."docker.io"]\n  ca = [' + json.dumps(str(bundle)) + "]\n")
            arguments = [
                "buildx",
                "create",
                "--name",
                name,
                "--driver",
                "docker-container",
                "--driver-opt",
                f"image={BUILDKIT_IMAGE}",
                "--driver-opt",
                "network=bridge",
                "--buildkitd-config",
                str(config),
                "--buildkitd-flags=--log-format=json",
            ]
            proxies = configured_proxies()
            for key, variable in (("httpProxy", "HTTP_PROXY"), ("httpsProxy", "HTTPS_PROXY"), ("noProxy", "NO_PROXY")):
                value = proxies.get(key)
                if value:
                    for alias in (variable, variable.lower()):
                        arguments.extend(("--driver-opt", driver_option(f"env.{alias}={value}")))
            arguments.extend(
                (
                    "--driver-opt",
                    f"env.SSL_CERT_FILE=/etc/buildkit/certs/docker.io/{bundle.name}",
                    SOCKET,
                )
            )
            # Capture output so builder options never print proxy credentials or CA contents.
            result = docker(*arguments, capture=True)
            if result.returncode:
                raise RuntimeError(
                    "Could not create the cloud builder; check local Docker and its proxy configuration."
                )
            result = docker("buildx", "inspect", name, "--bootstrap", capture=True)
            if result.returncode:
                raise RuntimeError("Could not start the cloud builder; inspect its container logs.")
            return
    result = docker("buildx", "inspect", name, "--bootstrap", capture=True)
    if result.returncode:
        raise RuntimeError("Could not start the existing cloud builder; inspect its container logs.")


def verify_arm64(name):
    with tempfile.TemporaryDirectory(prefix="cageledger-arm64-check-") as directory:
        context = Path(directory)
        (context / "Dockerfile").write_text(
            f"FROM {PROBE_IMAGE} AS probe\n"
            "RUN uname -m > /arm64-probe.txt\n"
            "FROM scratch\nCOPY --from=probe /arm64-probe.txt /arm64-probe.txt\n"
        )
        output = context / "result"
        result = docker(
            "buildx",
            "build",
            "--builder",
            name,
            "--platform",
            "linux/arm64",
            "--progress",
            "plain",
            "--no-cache",
            "--output",
            f"type=local,dest={output}",
            str(context),
        )
        if result.returncode or (output / "arm64-probe.txt").read_text().strip() != "aarch64":
            raise RuntimeError("The ARM64 execution probe failed; the builder is not ready for ARM64 packages.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="cageledger-cloud", help="Dedicated local builder name")
    arguments = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_.-]*", arguments.name):
        parser.error("Invalid builder name")
    try:
        ensure_builder(arguments.name)
        verify_arm64(arguments.name)
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f"{error}\n")
    print(f"ARM64 execution verified: {arguments.name}")
    print(f"CAGELEDGER_BUILDX_BUILDER={arguments.name} npm run package:container")


if __name__ == "__main__":
    main()
