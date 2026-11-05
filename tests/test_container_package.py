import gzip
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import textwrap
import unittest
from pathlib import Path

from scripts.container_archive import validate_archive

ROOT = Path(__file__).resolve().parents[1]


class OfflineImagePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        shutil.copyfile(ROOT / "scripts/package_offline_image.sh", self.root / "scripts/package_offline_image.sh")
        (self.root / "package.json").write_text(json.dumps({"version": "1.2.3"}))
        (self.root / "bin").mkdir()
        docker = self.root / "bin/docker"
        docker.write_text(
            f"#!{sys.executable}\n"
            "import json,os,sys\n"
            "from pathlib import Path\n"
            "args=sys.argv[1:]\n"
            "with Path(os.environ['MOCK_DOCKER_LOG']).open('a') as out: out.write(json.dumps(args)+'\\n')\n"
            "if args[:2]==['image','inspect']:\n"
            " arch=args[2].rsplit('-',1)[1]\n"
            " print(json.dumps([{'Os':'linux','Architecture':arch,'Config':{'Env':"
            "['CAGELEDGER_APP_VERSION='+os.environ.get('MOCK_IMAGE_VERSION','1.2.3')]}}]))\n"
            "elif args[0]=='save': sys.stdout.buffer.write(b'image archive bytes')\n"
        )
        docker.chmod(0o755)
        self.log = self.root / "commands.jsonl"
        self.env = {**os.environ, "PATH": str(self.root / "bin") + os.pathsep + os.environ["PATH"]}
        self.env["MOCK_DOCKER_LOG"] = str(self.log)

    def run_package(self, *args):
        return subprocess.run(
            ["bash", "scripts/package_offline_image.sh", *args],
            cwd=self.root,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_local_export_validates_only_arm64_and_never_pulls(self):
        result = self.run_package("--local")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([args[0] for args in self.commands()], ["image", "save"])
        archive = self.root / "dist/CageLedger-image-1.2.3-arm64.tar.gz"
        self.assertEqual(gzip.decompress(archive.read_bytes()), b"image archive bytes")
        self.assertFalse((self.root / "dist/CageLedger-image-1.2.3-amd64.tar.gz").exists())
        self.assertTrue((self.root / "dist/CageLedger-image-1.2.3-sha256.txt").is_file())

    def test_version_mismatch_keeps_previous_artifacts_and_does_not_export(self):
        (self.root / "dist").mkdir()
        archive = self.root / "dist/CageLedger-image-1.2.3-arm64.tar.gz"
        archive.write_bytes(b"previous-package")
        self.env["MOCK_IMAGE_VERSION"] = "0.0.0"
        result = self.run_package("--local")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(archive.read_bytes(), b"previous-package")
        self.assertFalse(any(args[0] in {"pull", "save"} for args in self.commands()))

    def test_default_export_retains_registry_pull_behavior(self):
        result = self.run_package()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([args[0] for args in self.commands()], ["pull", "save"])
        self.assertEqual(self.commands()[0][2], "linux/arm64")


class DirectContainerPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        for name in (
            "build_container_package.sh",
            "container_archive.py",
            "run_python.mjs",
            "python_runtime.mjs",
            "docker_local.sh",
            "publish_container_local.sh",
        ):
            shutil.copyfile(ROOT / "scripts" / name, self.root / "scripts" / name)
        (self.root / "package.json").write_text(json.dumps({"version": "1.2.3"}))
        binary_directory = self.root / "bin"
        binary_directory.mkdir()
        self.log = self.root / "commands.jsonl"
        self.revision = "a" * 40
        self.repository = "ddns.cellnucle.us:3333/hugo/cageledger"
        self.env = {
            **os.environ,
            "PATH": str(binary_directory) + os.pathsep + os.environ["PATH"],
            "CAGELEDGER_PYTHON_BIN": sys.executable,
            "CAGELEDGER_BUILDX_BUILDER": "default",
            "CAGELEDGER_BUILD_PRUNE": "0",
            "MOCK_DOCKER_LOG": str(self.log),
        }
        for variable in ("CAGELEDGER_REGISTRY", "CAGELEDGER_IMAGE_NAMESPACE", "CAGELEDGER_IMAGE_NAME"):
            self.env.pop(variable, None)
        git = binary_directory / "git"
        git.write_text(
            f"#!{sys.executable}\nimport shutil, sys\n"
            "if sys.argv[1:3] == ['worktree', 'remove']: shutil.rmtree(sys.argv[-1], ignore_errors=True)\n"
            f"print({'a' * 40!r})\n"
        )
        git.chmod(0o755)
        docker = binary_directory / "docker"
        docker.write_text(
            f"#!{sys.executable}\n"
            + textwrap.dedent(
                """\
                import io, json, os, sys, tarfile
                from pathlib import Path
                args = sys.argv[1:]
                if args[0].startswith('--host='): args.pop(0)
                with Path(os.environ['MOCK_DOCKER_LOG']).open('a') as out:
                    out.write(json.dumps(args) + '\\n')
                if args[:2] == ['context', 'show']:
                    print('colima')
                if args[:2] == ['context', 'inspect']:
                    print('unix:///Users/example/.colima/default/docker.sock')
                if args[:2] == ['buildx', 'inspect']:
                    print('Driver: docker-container\\nEndpoint: unix:///var/run/docker.sock')
                if args[:3] == ['buildx', 'imagetools', 'inspect']:
                    print(json.dumps({'manifests': [{'platform': {'os': 'linux', 'architecture': 'arm64'}}]}))
                if args[:2] == ['buildx', 'build'] and '--output' in args and 'type=docker' in args[args.index('--output') + 1]:
                    arch = args[args.index('--platform') + 1].split('/')[-1]
                    if os.environ.get('MOCK_FAIL_ARCHITECTURE') == arch: sys.exit(17)
                    tag = args[args.index('-t') + 1]
                    destination = args[args.index('--output') + 1].split('dest=', 1)[1]
                    revision = os.environ.get('MOCK_ARM_REVISION', 'a' * 40) if arch == 'arm64' else 'a' * 40
                    config = {'os': 'linux', 'architecture': arch, 'config': {'Env': [
                        'CAGELEDGER_APP_VERSION=1.2.3', 'CAGELEDGER_REVISION=' + revision]}}
                    files = {
                        'manifest.json': json.dumps([{'Config': 'config.json', 'RepoTags': [tag],
                                                       'Layers': ['layer.tar']}]).encode(),
                        'config.json': json.dumps(config).encode(),
                        'layer.tar': b'image layer bytes',
                    }
                    with tarfile.open(destination, 'w') as archive:
                        for name, content in files.items():
                            info = tarfile.TarInfo(name)
                            info.size = len(content)
                            archive.addfile(info, io.BytesIO(content))
                """
            )
        )
        docker.chmod(0o755)

    def run_package(self, *arguments):
        return subprocess.run(
            ["bash", "scripts/build_container_package.sh", *arguments],
            cwd=self.root,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def previous_packages(self):
        output = self.root / "dist"
        output.mkdir()
        packages = {}
        for suffix in ("amd64.tar.gz", "arm64.tar.gz", "load.txt", "sha256.txt"):
            path = output / f"CageLedger-image-1.2.3-{suffix}"
            content = f"previous {suffix}".encode()
            path.write_bytes(content)
            packages[path] = content
        return packages

    def test_darwin_colima_export_produces_checked_archive_without_loading_or_pulling(self):
        uname = self.root / "bin/uname"
        uname.write_text("#!/bin/sh\necho Darwin\n")
        uname.chmod(0o755)
        self.env.pop("CAGELEDGER_BUILDX_BUILDER")
        self.env.pop("DOCKER_HOST", None)
        self.env["DOCKER_CONTEXT"] = "colima"
        previous = self.previous_packages()
        result = self.run_package()
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = self.commands()
        self.assertFalse(any(args[0] in {"pull", "load", "save"} or "--load" in args for args in commands))
        builds = [args for args in commands if args[:2] == ["buildx", "build"]]
        self.assertEqual([args[args.index("--platform") + 1] for args in builds], ["linux/arm64"])
        self.assertEqual([args[args.index("--builder") + 1] for args in builds], ["colima"])
        self.assertIn(["context", "show"], commands)
        inspected_contexts = [args[2] for args in commands if args[:2] == ["context", "inspect"]]
        self.assertTrue(inspected_contexts)
        self.assertEqual(set(inspected_contexts), {"colima"})
        self.assertFalse(any(args[:2] == ["buildx", "prune"] for args in commands))
        output = self.root / "dist"
        path = output / "CageLedger-image-1.2.3-arm64.tar.gz"
        validate_archive(path, "arm64", "1.2.3", self.revision, f"{self.repository}:1.2.3-arm64")
        historical = output / "CageLedger-image-1.2.3-amd64.tar.gz"
        self.assertEqual(historical.read_bytes(), previous[historical])
        checksums = output / "CageLedger-image-1.2.3-sha256.txt"
        for line in checksums.read_text().splitlines():
            digest, name = line.split("  ", 1)
            self.assertFalse(Path(name).is_absolute())
            self.assertEqual(digest, hashlib.sha256((output / name).read_bytes()).hexdigest())
        self.assertEqual(len(checksums.read_text().splitlines()), 2)
        self.assertNotIn("amd64", checksums.read_text())
        notes = (output / "CageLedger-image-1.2.3-load.txt").read_text()
        self.assertIn("docker load -i CageLedger-image-1.2.3-arm64.tar.gz", notes)
        self.assertNotIn("AMD64", notes)
        self.assertFalse(list(output.glob(".container-package-*")))

    def test_failed_arm64_build_preserves_all_previous_artifacts(self):
        previous = self.previous_packages()
        self.env["MOCK_FAIL_ARCHITECTURE"] = "arm64"
        result = self.run_package()
        self.assertNotEqual(result.returncode, 0)
        for path, content in previous.items():
            self.assertEqual(path.read_bytes(), content)
        self.assertFalse(list((self.root / "dist").glob(".container-package-*")))

    def test_wrong_image_revision_preserves_all_previous_artifacts(self):
        previous = self.previous_packages()
        self.env["MOCK_ARM_REVISION"] = "old-revision"
        result = self.run_package()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("revision", result.stderr)
        for path, content in previous.items():
            self.assertEqual(path.read_bytes(), content)

    def test_explicit_pruning_runs_only_after_dedicated_builder_export(self):
        self.env["CAGELEDGER_BUILDX_BUILDER"] = "cageledger-cloud"
        self.env["CAGELEDGER_BUILD_PRUNE"] = "1"
        result = self.run_package()
        self.assertEqual(result.returncode, 0, result.stderr)
        actions = [args[1] for args in self.commands() if args[:2] in (["buildx", "build"], ["buildx", "prune"])]
        self.assertEqual(actions, ["build", "prune"])

    def test_pruning_default_or_unknown_builder_is_refused_before_building(self):
        for builder in ("default", "other-project"):
            with self.subTest(builder=builder):
                self.env["CAGELEDGER_BUILDX_BUILDER"] = builder
                result = self.run_package("--prune-cache")
                self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(args[:2] in (["buildx", "build"], ["buildx", "prune"]) for args in self.commands()))

    def test_legacy_publish_builds_only_arm64_and_never_targets_historical_amd64(self):
        result = subprocess.run(
            ["bash", "scripts/publish_container_local.sh", "--skip-base-sync", "--defer-latest"],
            cwd=self.root,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = self.commands()
        builds = [args for args in commands if args[:2] == ["buildx", "build"]]
        self.assertEqual([args[args.index("--platform") + 1] for args in builds], ["linux/arm64"])
        self.assertFalse(any("amd64" in argument for args in commands for argument in args))
        self.assertFalse(any(args[0] in {"rm", "rmi"} for args in commands))


class ContainerArchiveValidationTests(unittest.TestCase):
    def test_wrong_platform_or_version_metadata_is_rejected(self):
        metadata = {
            "os": "linux",
            "architecture": "arm64",
            "config": {"Env": ["CAGELEDGER_APP_VERSION=1.2.3", "CAGELEDGER_REVISION=abc"]},
        }
        for field, value in (("os", "windows"), ("architecture", "amd64"), ("config", {"Env": []})):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                archive_path = Path(directory) / "image.tar"
                modified = {**metadata, field: value}
                files = {
                    "manifest.json": json.dumps(
                        [{"Config": "config.json", "RepoTags": ["repo:tag"], "Layers": ["layer.tar"]}]
                    ).encode(),
                    "config.json": json.dumps(modified).encode(),
                    "layer.tar": b"layer",
                }
                with tarfile.open(archive_path, "w") as archive:
                    for name, content in files.items():
                        member = tarfile.TarInfo(name)
                        member.size = len(content)
                        archive.addfile(member, io.BytesIO(content))
                with self.assertRaisesRegex(ValueError, "OS, architecture, application version or revision"):
                    validate_archive(archive_path, "arm64", "1.2.3", "abc", "repo:tag")
