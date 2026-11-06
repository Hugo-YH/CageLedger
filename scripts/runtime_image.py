"""Freeze ARM64 dependencies once; reuse their exact OCI blobs for application builds."""

import argparse
import hashlib
import http.client
import json
import os
import re
import shlex
import shutil
import signal
import sys
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from cloud_registry import BASE, IMAGE, Client, Publisher, RegistryError, blob_path, descriptor, digest, encoded, save
from release_runtime import ROOT

LOCK = "runtime-image.lock.json"
LABEL = "org.cageledger.runtime.inputs"
CHUNK = 8 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise RegistryError(message)


def fingerprint(repo):
    dockerfile = (repo / "Dockerfile").read_text()
    base = re.search(r"^ARG PYTHON_IMAGE=(\S+)$", dockerfile, re.MULTILINE)
    require(base and re.search(r"@sha256:[0-9a-f]{64}$", base[1]), "Pin the Python base image by digest.")
    stage = dockerfile.split("FROM ${PYTHON_IMAGE} AS runtime-deps\n", 1)
    require(len(stage) == 2, "Missing runtime-deps build target.")
    stage = stage[1].split("FROM ${RUNTIME_IMAGE} AS runtime\n", 1)
    require(len(stage) == 2, "Missing pinned runtime image stage.")
    inputs = {
        "platform": "linux/arm64",
        "python_image": base[1],
        "stage": stage[0],
        "files": {
            name: digest(repo / name)
            for name in (
                "requirements.txt",
                "requirements-runtime.txt",
                "scripts/with_build_ca.sh",
                "scripts/retry_command.sh",
            )
        },
    }
    return hashlib.sha256(encoded(inputs)).hexdigest()


def check_image(layout, lock, *, check_layers=True):
    manifest = json.loads(descriptor(layout, lock["manifest"]).read_bytes())
    require(manifest.get("layers") == lock["layers"], "Runtime layer descriptors changed.")
    require(manifest.get("config") == lock["config"], "Runtime config descriptor changed.")
    config = json.loads(descriptor(layout, lock["config"]).read_bytes())
    require((config.get("os"), config.get("architecture")) == ("linux", "arm64"), "Runtime must be Linux ARM64.")
    require(
        config.get("config", {}).get("Labels", {}).get(LABEL) == lock["inputs_sha256"], "Runtime input label differs."
    )
    environment = config.get("config", {}).get("Env", [])
    require(
        not any(item.startswith(("CAGELEDGER_APP_VERSION=", "CAGELEDGER_REVISION=")) for item in environment),
        "The pinned runtime must not contain an application release.",
    )
    require(len(config.get("rootfs", {}).get("diff_ids", [])) == len(lock["layers"]), "Runtime rootfs differs.")
    for item in lock["layers"]:
        require(item.get("mediaType") == "application/vnd.oci.image.layer.v1.tar+gzip", "Runtime requires gzip layers.")
        if check_layers:
            descriptor(layout, item)
    return manifest


def load_lock(repo):
    require((repo / LOCK).is_file(), "Runtime is not pinned; run npm run runtime:refresh first.")
    lock = json.loads((repo / LOCK).read_bytes())
    require(lock.get("schema") == 1 and lock.get("platform") == "linux/arm64", "Unsupported runtime lock.")
    require(
        lock.get("inputs_sha256") == fingerprint(repo), "Runtime dependencies changed; run npm run runtime:refresh."
    )
    value = lock["manifest"]["digest"]
    blob_path(Path("."), value)
    require(lock.get("reference") == "git.cellnucle.us/hugo/cageledger@" + value, "Unexpected runtime registry.")
    require(
        lock.get("tag") == "runtime-" + value.split(":")[1][:16] + "-arm64", "Runtime tag is not content-addressed."
    )
    return lock


def state_directory(repo):
    return repo.parent / (repo.name + "-runtime-state")


def cache_layout(repo, lock, state=None):
    state = Path(state or state_directory(repo)).resolve()
    require(not state.is_relative_to(repo.resolve()), "Runtime state must be outside the checkout.")
    return state / lock["manifest"]["digest"].split(":")[1] / "oci"


def download_blob(client, item, destination):
    """Bounded-memory streaming; resume when supported and handle non-range registries."""
    temporary = destination.with_suffix(".partial")
    intent = destination.with_suffix(".download.json")
    identity = {"digest": item["digest"], "size": item["size"]}
    if intent.exists():
        require(json.loads(intent.read_bytes()) == identity, "Unknown partial runtime download.")
    else:
        require(not temporary.exists(), "Unknown existing runtime partial; preserve it for inspection.")
        save(intent, identity)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with temporary.open("ab") as output:
        offset = output.tell()
        require(offset <= item["size"], "Runtime partial exceeds the expected blob.")
        if offset < item["size"]:
            with client.open_blob(item["digest"], offset=offset) as response, temporary.open("rb") as previous:
                status, headers = response.status, response.headers
                resume = status == 206
                require(status in {200, 206}, "Registry blob stream failed.")
                if resume:
                    require(
                        headers.get("Content-Range") == f"bytes {offset}-{item['size'] - 1}/{item['size']}",
                        "Runtime resume range differs.",
                    )
                remaining = item["size"] - offset if resume else item["size"]
                require(int(headers.get("Content-Length", remaining)) == remaining, "Runtime blob size differs.")
                skip, received, durable = (0 if resume else offset), 0, 0
                while body := response.read(min(CHUNK, 64 * 1024)):
                    received += len(body)
                    require(received <= remaining, "Runtime download exceeds its declared size.")
                    # Some registries ignore Range. Preserve and compare the owned
                    # prefix while consuming the unavoidable full response once.
                    count = min(skip, len(body))
                    require(body[:count] == previous.read(count), "Runtime partial prefix changed.")
                    skip -= count
                    output.write(body[count:])
                    durable += len(body) - count
                    if durable >= CHUNK:
                        output.flush()
                        os.fsync(output.fileno())
                        durable = 0
                output.flush()
                os.fsync(output.fileno())
                require(received == remaining and skip == 0, "Runtime blob stream was incomplete.")
    require(digest(temporary) == item["digest"], "Runtime blob SHA256 differs; preserve the partial for inspection.")
    temporary.replace(destination)
    intent.unlink()


def ensure_layout(repo, lock, *, state=None, client=None):
    layout = cache_layout(repo, lock, state)
    layout.mkdir(parents=True, exist_ok=True, mode=0o700)

    def acquire(item, *, manifest=False):
        nonlocal client
        destination = blob_path(layout, item["digest"])
        if destination.exists():
            descriptor(layout, item)
            return
        # Existing application exports contain the identical compressed parent blobs.
        source = next(
            (repo.parent / (repo.name + "-registry-state")).glob("*/oci/blobs/sha256/" + item["digest"].split(":")[1]),
            None,
        )
        if source is not None:
            descriptor(source.parents[2], item)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            return
        if client is None:
            client = Client()
        if manifest:
            status, _, body = client.request("GET", BASE + "/manifests/" + item["digest"], headers={"Accept": IMAGE})
            require(status == 200 and len(body) == item["size"], "Runtime manifest is missing or incomplete.")
            require("sha256:" + hashlib.sha256(body).hexdigest() == item["digest"], "Runtime manifest SHA differs.")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(body)
        else:
            download_blob(client, item, destination)
        descriptor(layout, item)

    acquire(lock["manifest"], manifest=True)
    acquire(lock["config"])
    manifest = json.loads(blob_path(layout, lock["manifest"]["digest"]).read_bytes())
    require(
        manifest.get("layers") == lock["layers"] and manifest.get("config") == lock["config"], "Runtime lock differs."
    )
    check_image(layout, lock, check_layers=False)
    for index, item in enumerate(lock["layers"], 1):
        acquire(item)
        print(f"Verified pinned runtime layer {index}/{len(lock['layers'])}", file=sys.stderr, flush=True)
    check_image(layout, lock)
    save(layout / "oci-layout", {"imageLayoutVersion": "1.0.0"})
    save(
        layout / "index.json",
        {"schemaVersion": 2, "manifests": [{**lock["manifest"], "platform": {"os": "linux", "architecture": "arm64"}}]},
    )
    return layout


def lock_export(repo, layout):
    index = json.loads((layout / "index.json").read_bytes())
    require(len(index.get("manifests", [])) == 1, "Runtime export must contain one image, without attestations.")
    item = index["manifests"][0]
    manifest = json.loads(descriptor(layout, item).read_bytes())
    value = item["digest"]
    lock = {
        "schema": 1,
        "platform": "linux/arm64",
        "inputs_sha256": fingerprint(repo),
        "reference": "git.cellnucle.us/hugo/cageledger@" + value,
        "tag": "runtime-" + value.split(":")[1][:16] + "-arm64",
        "manifest": {"digest": value, "size": item["size"], "mediaType": IMAGE},
        "config": manifest["config"],
        "layers": manifest["layers"],
    }
    check_image(layout, lock)
    return lock


def publish_runtime(repo, lock, layout, client, state):
    plan = {
        "identity": {"inputs_sha256": lock["inputs_sha256"], "manifest": lock["manifest"]["digest"]},
        "layout_directory": str(layout),
    }
    publisher = Publisher(plan, state, client)
    remote = client.manifest(lock["tag"])
    require(
        remote is None or remote[0] == lock["manifest"]["digest"], "Conflicting runtime tag; it was not overwritten."
    )
    if remote is None:
        for item in [lock["config"], *lock["layers"]]:
            publisher.blob(item)
        publisher.tag(lock["tag"], lock["manifest"])
    actual = client.manifest(lock["tag"])
    require(actual and actual[0] == lock["manifest"]["digest"], "Runtime publication differs.")
    status, _, body = client.request("GET", BASE + "/blobs/" + lock["config"]["digest"])
    require(
        status == 200 and body == descriptor(layout, lock["config"]).read_bytes(), "Published runtime config differs."
    )
    require(all(publisher.has_blob(item) for item in lock["layers"]), "Published runtime layer is missing.")
    cached = cache_layout(repo, lock)
    cached.mkdir(parents=True, exist_ok=True)
    for item in [lock["manifest"], lock["config"], *lock["layers"]]:
        source, target = descriptor(layout, item), blob_path(cached, item["digest"])
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            shutil.copyfile(source, target)
    ensure_layout(repo, lock)
    save(repo / LOCK, lock)  # Only a fully verified immutable runtime may become the tracked pin.


@contextmanager
def runner_signals(runner):
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        for sig in previous:
            signal.signal(sig, lambda *_: runner.stopping.set())
        yield
        require(not runner.stopping.is_set(), "Runtime refresh was cancelled before publication.")
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def build_export(repo, job, runner, command, environment):
    output, proof = job / "oci", job / "export-verified.json"
    if proof.exists():
        lock = lock_export(repo, output)
        require(json.loads(proof.read_bytes()) == lock, "Verified runtime export changed; inspect its state.")
        return lock
    if output.exists():
        try:
            lock = lock_export(repo, output)
        except (RegistryError, OSError, ValueError, KeyError, TypeError):
            # This directory was allocated by the durable refresh intent. Preserve
            # its partial contents and use the same BuildKit dependency cache.
            output.rename(job / ("incomplete-oci-" + uuid4().hex[:8]))
        else:
            save(proof, lock)
            return lock
    runner.run(command, job / ("build-" + uuid4().hex[:8] + ".log"), env=environment)
    lock = lock_export(repo, output)
    save(proof, lock)
    return lock


def refresh(repo, *, rebuild=False):
    from linux_test_guard import LinuxTestGuard
    from release_host_guard import HostGuard
    from release_runtime import Runner, isolation_environment
    from verification_host import host_task_lock

    state = state_directory(repo)
    state.mkdir(parents=True, exist_ok=True)
    intent_path = state / "refresh-intent.json"
    inputs = fingerprint(repo)
    prior = json.loads(intent_path.read_bytes()) if intent_path.exists() else None
    if prior and prior.get("status") != "complete":
        require(prior["inputs"] == inputs and prior["rebuild"] == rebuild, "Resume the existing runtime refresh first.")
        require(re.fullmatch(r"refresh-" + inputs[:12] + r"-[0-9a-f]{8}", prior["directory"]), "Invalid refresh owner.")
        job = state / prior["directory"]
    else:
        job = state / ("refresh-" + inputs[:12] + "-" + uuid4().hex[:8])
        job.mkdir()
        save(intent_path, {"inputs": inputs, "rebuild": rebuild, "directory": job.name, "status": "building"})
    with host_task_lock():
        guard = (LinuxTestGuard if sys.platform == "linux" else HostGuard)(job / "host")
        runner = Runner(repo, guard)
        output = job / "oci"
        with runner_signals(runner):
            require(guard.admit(), guard.reason)
            options = [
                "--builder",
                os.environ.get("CAGELEDGER_BUILDX_BUILDER", "cageledger-cloud"),
                "--platform",
                "linux/arm64",
                "--target",
                "runtime-deps",
                "--provenance=false",
                "--sbom=false",
                "--build-arg",
                "CAGELEDGER_RUNTIME_FINGERPRINT=" + inputs,
                "--output",
                "type=oci,tar=false,dest=" + str(output),
            ]
            if rebuild:
                options += ["--no-cache-filter", "runtime-deps"]
            for secret, path in (
                ("proxy_ca", os.environ.get("CODEX_PROXY_CERT")),
                ("ca_bundle", os.environ.get("CAGELEDGER_BUILD_CA_BUNDLE", "/etc/ssl/certs/ca-certificates.crt")),
            ):
                if path:
                    require(Path(path).is_file(), "Configured runtime build CA is missing.")
                    options += ["--secret", "id=" + secret + ",src=" + path]
            shell = "set -e\nsource scripts/docker_local.sh\ndocker_local buildx build " + shlex.join([*options, "."])
            lock = build_export(repo, job, runner, ["bash", "-c", shell], isolation_environment())
            require(fingerprint(repo) == inputs, "Runtime inputs changed during the build.")
        publish_runtime(repo, lock, output, Client(), job / "publication")
        save(intent_path, {"inputs": inputs, "rebuild": rebuild, "directory": job.name, "status": "complete"})
    print("Pinned ARM64 runtime: " + lock["reference"])
    print("Review and commit " + LOCK + "; application versions/latest were not changed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    context = sub.add_parser("context")
    context.add_argument(
        "--docker-registry", help="Use existing Docker authentication, e.g. on the optional Mac runner"
    )
    refresh_parser = sub.add_parser("refresh")
    refresh_parser.add_argument(
        "--rebuild", action="store_true", help="Explicitly refresh OS dependencies without cached RUNs"
    )
    options = parser.parse_args()
    if options.command == "refresh":
        refresh(ROOT, rebuild=options.rebuild)
    else:
        lock = load_lock(ROOT)
        if options.docker_registry:
            require(
                re.fullmatch(r"[A-Za-z0-9.-]+(?::\d+)?", options.docker_registry), "Invalid Docker runtime registry."
            )
            print("docker-image://" + options.docker_registry + "/hugo/cageledger@" + lock["manifest"]["digest"])
        else:
            layout = ensure_layout(ROOT, lock)
            print("oci-layout://" + str(layout) + "@" + lock["manifest"]["digest"])


if __name__ == "__main__":
    try:
        main()
    except (RegistryError, OSError, ValueError, KeyError, TypeError, RuntimeError, http.client.HTTPException) as error:
        raise SystemExit(
            str(error) if isinstance(error, RegistryError) else "Runtime setup stopped; preserve its external state."
        ) from None
