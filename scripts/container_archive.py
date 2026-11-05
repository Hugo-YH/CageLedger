"""Validate an ARM64 Docker archive and finish its staged offline package."""

import argparse
import hashlib
import json
import os
import re
import tarfile
from pathlib import Path


def read_archive_json(archive, name):
    member = archive.getmember(name)
    if not member.isfile() or member.size > 4 * 1024 * 1024:
        raise ValueError(f"Invalid image metadata entry: {name}")
    with archive.extractfile(member) as stream:
        return json.load(stream)


def validate_archive(path, architecture, version, revision, image_tag):
    if architecture != "arm64":
        raise ValueError("Only the Linux ARM64 image is supported by the current release policy.")
    with tarfile.open(path, "r:*") as archive:
        manifest = read_archive_json(archive, "manifest.json")
        if not isinstance(manifest, list) or len(manifest) != 1:
            raise ValueError("The Docker archive must contain exactly one image.")
        entry = manifest[0]
        if image_tag not in entry.get("RepoTags", []):
            raise ValueError("The Docker archive does not contain the requested image tag.")
        metadata = read_archive_json(archive, entry["Config"])
        variables = dict(value.split("=", 1) for value in metadata.get("config", {}).get("Env", []) if "=" in value)
        expected = ("linux", architecture, version, revision)
        actual = (
            metadata.get("os"),
            metadata.get("architecture"),
            variables.get("CAGELEDGER_APP_VERSION"),
            variables.get("CAGELEDGER_REVISION"),
        )
        if actual != expected:
            raise ValueError("Image OS, architecture, application version or revision does not match the package.")
        layers = entry.get("Layers", [])
        if not layers or any(not archive.getmember(layer).isfile() for layer in layers):
            raise ValueError("The Docker archive has missing or invalid image layers.")


def check_prune_builder(name, description):
    # Only builders created for this cloud task may lose their build cache.
    if name not in {"cageledger-cloud", "cageledger-cloud-arm64-probe"}:
        raise ValueError("Cache pruning is allowed only for the dedicated CageLedger cloud builder.")
    driver = re.search(r"^Driver:\s+(\S+)", description, re.MULTILINE)
    endpoints = re.findall(r"^Endpoint:\s+(\S+)", description, re.MULTILINE)
    if not driver or driver.group(1) != "docker-container" or endpoints != ["unix:///var/run/docker.sock"]:
        raise ValueError("Refusing to prune a builder outside the dedicated local Docker container.")


def finalize_packages(staging, output, version, repository):
    prefix = f"CageLedger-image-{version}"
    archives = [f"{prefix}-arm64.tar.gz"]
    for name in archives:
        if not (staging / name).is_file() or not (staging / name).stat().st_size:
            raise ValueError("The ARM64 archive must exist before replacing previous packages.")
    notes_name = f"{prefix}-load.txt"
    (staging / notes_name).write_text(
        f"""CageLedger {version} 离线镜像包

ARM64 主机：
  docker load -i {archives[0]}
  docker tag {repository}:{version}-arm64 {repository}:{version}

加载后可直接使用：
  docker run --rm -p 5173:5173 {repository}:{version}

如果使用 compose：
  将镜像 tag 固定为 {version}
""",
        encoding="utf-8",
    )
    names = [*archives, notes_name]
    checksum_name = f"{prefix}-sha256.txt"
    with (staging / checksum_name).open("w", encoding="utf-8") as checksums:
        for name in names:
            with (staging / name).open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            checksums.write(f"{digest}  {name}\n")
    # Build, validation, compression and checksums all finish before old files change.
    for name in [*names, checksum_name]:
        os.replace(staging / name, output / name)
        print(output / name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate")
    validate.add_argument("--archive", type=Path, required=True)
    validate.add_argument("--architecture", choices=("arm64",), required=True)
    for option in ("version", "revision", "image-tag"):
        validate.add_argument(f"--{option}", required=True)
    check_builder = commands.add_parser("check-builder")
    check_builder.add_argument("--name", required=True)
    finalize = commands.add_parser("finalize")
    for option in ("staging", "output"):
        finalize.add_argument(f"--{option}", type=Path, required=True)
    for option in ("version", "repository"):
        finalize.add_argument(f"--{option}", required=True)
    arguments = parser.parse_args()
    try:
        if arguments.command == "validate":
            validate_archive(
                arguments.archive, arguments.architecture, arguments.version, arguments.revision, arguments.image_tag
            )
        elif arguments.command == "check-builder":
            import sys

            check_prune_builder(arguments.name, sys.stdin.read())
        else:
            finalize_packages(arguments.staging, arguments.output, arguments.version, arguments.repository)
    except (KeyError, OSError, TypeError, ValueError, tarfile.TarError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
