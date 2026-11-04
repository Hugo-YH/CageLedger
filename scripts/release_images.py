"""Recover managed image uploads using config digests saved before any push."""

import hashlib
import json
import re
import subprocess
import tarfile
import tempfile
from pathlib import Path

from release_runtime import atomic_json, command, manifest_result, require

IMAGE = "ddns.cellnucle.us:3333/hugo/cageledger"
BASE = "ddns.cellnucle.us:3333/hugo/cageledger-base"
ARCHES = ("arm64", "amd64")


def archive_identity(path):
    """Read config identity from OCI, including drivers without config metadata."""
    with tarfile.open(path) as archive:

        def read(name, expected=None):
            member = archive.getmember(name)
            require(member.isfile() and member.size < 4 * 1024 * 1024, "Invalid OCI metadata member")
            data = archive.extractfile(member).read()
            require(
                expected is None or "sha256:" + hashlib.sha256(data).hexdigest() == expected,
                "OCI descriptor content changed",
            )
            return json.loads(data)

        index = read("index.json")
        require(len(index["manifests"]) == 1, "Expected single-platform OCI build")
        manifest = index["manifests"][0]["digest"]
        require(re.fullmatch(r"sha256:[0-9a-f]{64}", manifest), "Invalid OCI manifest digest")
        value = read("blobs/sha256/" + manifest.split(":")[1], manifest)
        config = value.get("config", {}).get("digest", "")
        require(re.fullmatch(r"sha256:[0-9a-f]{64}", config), "Buildx config digest missing")
        return config, manifest


def remote_manifest(repo, reference):
    result = subprocess.run(
        ["docker", "buildx", "imagetools", "inspect", "--raw", reference],
        cwd=repo,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    return json.loads(result.stdout) if manifest_result(result, reference) is not None else None


def config_digest(repo, reference, manifest, arch):
    if "manifests" in manifest:
        children = [
            m
            for m in manifest["manifests"]
            if m.get("platform", {}).get("os") == "linux" and m.get("platform", {}).get("architecture") == arch
        ]
        require(len(children) == 1, "Image architecture missing/duplicated")
        child = children[0]["digest"]
        require(re.fullmatch(r"sha256:[0-9a-f]{64}", child), "Invalid image descriptor")
        manifest = remote_manifest(repo, reference.split("@", 1)[0] + "@" + child)
        require(manifest is not None and "config" in manifest, "Image child unavailable")
    value = manifest.get("config", {}).get("digest", "")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", value), "Image config digest unavailable")
    return value


class ImagePublisher:
    def __init__(self, repo, version, revision, directory, execute):
        self.repo, self.version, self.revision = repo, version, revision
        self.directory, self.execute = Path(directory), execute
        self.path = self.directory / "image-publication.json"
        identity = {"repo": str(repo.resolve()), "version": version, "revision": revision, "image": IMAGE}
        self.data = (
            json.loads(self.path.read_text()) if self.path.exists() else {"identity": identity, "architectures": {}}
        )
        require(self.data.get("identity") == identity, "Image receipt belongs to a different release")
        self.directory.mkdir(parents=True, exist_ok=True)
        self.save()

    def save(self):
        atomic_json(self.path, self.data)

    def run(self, name, args):
        # Each retry keeps its own log. No build or push is retried blindly.
        from uuid import uuid4

        self.execute(args, self.directory / f"{name}-{uuid4().hex}.log")

    def local_image(self, reference, arch):
        value = json.loads(command(["docker", "image", "inspect", reference], self.repo))[0]
        require(value["Os"] == "linux" and value["Architecture"] == arch, "Local image architecture mismatch")
        env = dict(v.split("=", 1) for v in value["Config"].get("Env", []) if "=" in v)
        require(
            env.get("CAGELEDGER_APP_VERSION") == self.version and env.get("CAGELEDGER_REVISION") == self.revision,
            "Local image release identity mismatch",
        )
        require(re.fullmatch(r"sha256:[0-9a-f]{64}", value["Id"]), "Local image config digest invalid")
        return value["Id"]

    def architecture(self, arch, worktree):
        reference = f"{IMAGE}:{self.version}-{arch}"
        receipt = self.data["architectures"].get(arch, {})
        remote = remote_manifest(self.repo, reference)
        if remote is not None:
            require(receipt.get("expected_config") is not None, "Existing image has no pre-push ownership receipt")
            require(
                config_digest(self.repo, reference, remote, arch) == receipt["expected_config"],
                "Existing version image conflicts with receipt; not overwritten",
            )
        else:
            if not receipt.get("expected_config"):
                metadata = self.directory / f"{arch}-build.json"
                archive = self.directory / f"{arch}-build.oci.tar"
                self.run(
                    "build-" + arch,
                    [
                        "docker",
                        "buildx",
                        "build",
                        "--platform",
                        "linux/" + arch,
                        "--build-arg",
                        f"NODE_IMAGE={BASE}:node-22-bookworm-slim",
                        "--build-arg",
                        f"PYTHON_IMAGE={BASE}:python-3.13-slim",
                        "--build-arg",
                        "CAGELEDGER_APP_VERSION=" + self.version,
                        "--build-arg",
                        "CAGELEDGER_REVISION=" + self.revision,
                        "--provenance=false",
                        "--metadata-file",
                        str(metadata),
                        "--load",
                        "--output",
                        f"type=oci,dest={archive}",
                        "-t",
                        reference,
                        str(worktree),
                    ],
                )
                built = json.loads(metadata.read_text())
                config, manifest = archive_identity(archive)
                require(
                    built.get("containerimage.config.digest", config) == config, "Buildx metadata and OCI config differ"
                )
                local_id = self.local_image(reference, arch)
                require(
                    local_id in {config, manifest, built.get("containerimage.digest")},
                    "Loaded image differs from Buildx metadata",
                )
                receipt = {"expected_config": config, "local_id": local_id}
                self.data["architectures"][arch] = receipt
                self.save()  # Durable ownership evidence BEFORE the registry mutation.
                archive.unlink()
            require(
                self.local_image(reference, arch) == receipt.get("local_id"),
                "Local image changed/missing since build; inspect before resuming",
            )
            # Recheck after a potentially lengthy build, before pushing a version tag.
            remote = remote_manifest(self.repo, reference)
            if remote is None:
                self.run("push-" + arch, ["docker", "push", reference])
                remote = remote_manifest(self.repo, reference)
            require(
                remote is not None and config_digest(self.repo, reference, remote, arch) == receipt["expected_config"],
                "Pushed image does not match local build",
            )
        receipt["verified"] = True
        self.data["architectures"][arch] = receipt
        self.save()

    def publish(self):
        reference = f"{IMAGE}:{self.version}"
        # Even a previously completed index is verified against pre-push config
        # digests below. A foreign tag must never be accepted by version alone.
        existing = remote_manifest(self.repo, reference)
        require(
            existing is None or all(self.data["architectures"].get(a, {}).get("expected_config") for a in ARCHES),
            "Existing manifest has no ownership receipt",
        )
        with tempfile.TemporaryDirectory(prefix="cageledger-image-source-") as temporary:
            worktree = Path(temporary) / "source"
            command(["git", "worktree", "add", "--detach", str(worktree), self.revision], self.repo)
            try:
                if not self.data.get("base_synced"):
                    for tag, upstream in (
                        ("node-22-bookworm-slim", "node:22-bookworm-slim"),
                        ("python-3.13-slim", "python:3.13-slim"),
                    ):
                        self.run(
                            "base-sync",
                            [
                                "docker",
                                "buildx",
                                "imagetools",
                                "create",
                                "-t",
                                BASE + ":" + tag,
                                "docker.io/library/" + upstream,
                            ],
                        )
                    self.data["base_synced"] = True
                    self.save()
                for arch in ARCHES:
                    self.architecture(arch, worktree)
            finally:
                command(["git", "worktree", "remove", "--force", str(worktree)], self.repo)
        existing = remote_manifest(self.repo, reference)
        if existing is None:
            self.run(
                "manifest",
                ["docker", "buildx", "imagetools", "create", "-t", reference, *[f"{reference}-{a}" for a in ARCHES]],
            )
            existing = remote_manifest(self.repo, reference)
        require(existing is not None and "manifests" in existing, "Combined image index unavailable")
        actual_arches = [
            m.get("platform", {}).get("architecture")
            for m in existing["manifests"]
            if m.get("platform", {}).get("os") == "linux"
        ]
        require(sorted(actual_arches) == sorted(ARCHES), "Unexpected combined image architectures")
        for arch in ARCHES:
            require(
                config_digest(self.repo, reference, existing, arch)
                == self.data["architectures"][arch]["expected_config"],
                "Combined manifest conflicts with build receipt",
            )
        self.data["manifest_verified"] = True
        self.save()
        self.run("offline-images", ["bash", "scripts/package_offline_image.sh", "--version", self.version])


def publish_images(pipeline):
    from release_runtime import hashed, tree

    journal, repo = pipeline.journal, pipeline.repo
    previous = journal.data["stages"].get("images")
    reference = f"{IMAGE}:{pipeline.version}"
    if previous and previous["status"] == "passed":
        require(journal.reusable("images", previous["fingerprint"]), "Image evidence changed/missing")
        manifest = remote_manifest(repo, reference)
        require(
            manifest is not None and hashed(manifest) == journal.data.get("image_manifest"), "Version manifest changed"
        )
        return
    directory = journal.directory / "image-publication"
    if previous:
        require(
            (directory / "image-publication.json").is_file(),
            "Partial image publication without an ownership receipt requires manual inspection",
        )
        require(previous["fingerprint"] == pipeline.fingerprint(), "Image source changed; no resume allowed")
    attempt = journal.begin("images", pipeline.fingerprint(), mutation=True)
    try:
        publisher = ImagePublisher(repo, pipeline.version, journal.data["commit"], directory, pipeline.runner.run)
        publisher.publish()
        manifest = remote_manifest(repo, reference)
        journal.data["image_manifest"] = hashed(manifest)
        (attempt / "command.log").write_text(
            "Architecture config digests and combined manifest verified; details in image-publication/.\n"
        )
        outputs = [
            attempt / "command.log",
            directory,
            *sorted((repo / "dist").glob(f"CageLedger-image-{pipeline.version}-*")),
        ]
        for output in outputs:
            tree(output)
        journal.end("images", "passed", outputs)
    except BaseException:
        journal.end("images", "unknown")
        raise
