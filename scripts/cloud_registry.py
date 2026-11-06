"""Push a verified ARM64 OCI layout through the scoped HTTPS Gitea registry."""

import argparse
import hashlib
import json
import os
import re
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath

from cloud_package_delivery import source_identity
from gitea_release_assets import ORIGIN, ReleaseAssets

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "hugo/cageledger"
BASE = "/v2/" + REPOSITORY
CHUNK = 8 * 1024 * 1024
LIMIT = 8 * 1024 * 1024
IMAGE = "application/vnd.oci.image.manifest.v1+json"
INDEX = "application/vnd.oci.image.index.v1+json"
CONFIG = "application/vnd.oci.image.config.v1+json"
LAYER = "application/vnd.oci.image.layer.v1.tar+gzip"


class RegistryError(RuntimeError):
    pass


class HTTPFailure(RegistryError):
    def __init__(self, method, path, status):
        self.status = status
        super().__init__(f"Registry {method} {urllib.parse.urlsplit(path).path}: HTTP {status}")


def require(condition, message):
    if not condition:
        raise RegistryError(message)


def digest(path):
    with Path(path).open("rb") as stream:
        return "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(mode="wb", dir=path.parent, prefix=".receipt-", delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(encoded(value) + b"\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def blob_path(layout, value):
    require(isinstance(value, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", value), "Invalid OCI digest.")
    return layout / "blobs/sha256" / value.split(":")[1]


def descriptor(layout, value):
    require(isinstance(value, dict) and type(value.get("size")) is int, "Invalid OCI descriptor.")
    path = blob_path(layout, value.get("digest"))
    require(
        path.is_file()
        and not path.is_symlink()
        and path.stat().st_size == value["size"]
        and digest(path) == value["digest"],
        "OCI descriptor bytes/size mismatch.",
    )
    return path


def read_json(path):
    require(path.stat().st_size <= LIMIT, "OCI metadata exceeds the limit.")
    value = json.loads(path.read_bytes())
    require(isinstance(value, dict), "OCI metadata must be an object.")
    return value


def check_config(value, version, revision):
    environment = dict(item.split("=", 1) for item in value.get("config", {}).get("Env", []) if "=" in item)
    require(
        (
            value.get("os"),
            value.get("architecture"),
            environment.get("CAGELEDGER_APP_VERSION"),
            environment.get("CAGELEDGER_REVISION"),
        )
        == ("linux", "arm64", version, revision),
        "Registry config OS/architecture/version/revision mismatch.",
    )


def store_bytes(layout, body):
    value = "sha256:" + hashlib.sha256(body).hexdigest()
    path = blob_path(layout, value)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        require(path.is_file() and not path.is_symlink() and digest(path) == value, "Existing OCI blob changed.")
    else:
        with path.open("xb") as output:
            output.write(body)
    return {"digest": value, "size": len(body)}


def prepare_archive(archive, state, version, revision):
    """Offline-only preparation; layout is reusable by BuildKit and subsequent upload."""
    archive, state = Path(archive).resolve(), Path(state).resolve()
    require(not state.is_relative_to(ROOT.resolve()), "Registry state must be outside the checkout.")
    require(archive.is_file(), "Registry archive is missing.")
    identity = {"archive_sha256": digest(archive), "version": version, "revision": revision, "platform": "linux/arm64"}
    layout, prepared = state / "oci", state / "prepared.json"
    if prepared.exists():
        plan = read_json(prepared)
        require(plan.get("identity") == identity, "Prepared OCI layout belongs to a different archive/release.")
        require(plan.get("layout_directory") == str(layout), "Prepared OCI layout path changed.")
        for item in [*plan["blobs"], plan["manifest"], plan["index"]]:
            descriptor(layout, item)
        check_config(read_json(descriptor(layout, plan["config"])), version, revision)
        require(
            (layout / "index.json").read_bytes() == descriptor(layout, plan["index"]).read_bytes(),
            "Prepared OCI index changed.",
        )
        return plan
    intent = state / "preparation-intent.json"
    if intent.exists():
        require(read_json(intent) == identity, "OCI preparation belongs to another archive.")
    else:
        require(
            not layout.exists() or not any(layout.iterdir()),
            "Unknown existing OCI layout; choose another state directory.",
        )
        save(intent, identity)
    layout.mkdir(parents=True, exist_ok=True)
    metadata, seen = {}, set()
    with tarfile.open(archive, "r|*") as source:
        for member in source:
            name = member.name.removeprefix("./").rstrip("/")
            parts = PurePosixPath(name).parts
            require(
                name not in seen and not name.startswith("/") and ".." not in parts,
                "Unsafe or duplicate OCI archive path.",
            )
            seen.add(name)
            require(member.isfile() or member.isdir(), "OCI archive must contain only regular entries.")
            if member.isdir():
                require(name in {"", ".", "blobs", "blobs/sha256"}, "Unknown OCI archive directory.")
                continue
            require(
                name in {"index.json", "oci-layout", "manifest.json"}
                or re.fullmatch(r"blobs/sha256/[0-9a-f]{64}", name),
                "OCI archive requires digest paths.",
            )
            stream = source.extractfile(member)
            if name in {"index.json", "oci-layout", "manifest.json"}:
                require(member.size <= LIMIT, "OCI metadata exceeds the limit.")
                metadata[name] = stream.read()
                continue
            expected = "sha256:" + name.rsplit("/", 1)[1]
            path = blob_path(layout, expected)
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".blob-", delete=False) as output:
                    temporary = Path(output.name)
                    hasher, count = hashlib.sha256(), 0
                    while block := stream.read(65536):
                        output.write(block)
                        hasher.update(block)
                        count += len(block)
                require(
                    count == member.size and "sha256:" + hasher.hexdigest() == expected,
                    "OCI archive blob SHA256 mismatch.",
                )
                if path.exists() or path.is_symlink():
                    require(
                        path.is_file() and not path.is_symlink() and digest(path) == expected,
                        "Existing OCI blob changed.",
                    )
                else:
                    temporary.replace(path)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
    require({"oci-layout", "index.json"} <= set(metadata), "The Docker archive must contain a standard OCI layout.")
    require(json.loads(metadata["oci-layout"]).get("imageLayoutVersion") == "1.0.0", "Unsupported OCI layout.")
    index = json.loads(metadata["index.json"])
    require(len(index.get("manifests", [])) == 1, "Expected one ARM64 OCI manifest.")
    child = index["manifests"][0]
    platform = child.get("platform", {})
    require(
        not platform or (platform.get("os"), platform.get("architecture")) == ("linux", "arm64"),
        "OCI index platform is not Linux ARM64.",
    )
    manifest = read_json(descriptor(layout, child))
    require(manifest.get("schemaVersion") == 2 and "config" in manifest, "Invalid OCI image manifest.")
    config = read_json(descriptor(layout, manifest["config"]))
    check_config(config, version, revision)
    layers = manifest.get("layers", [])
    require(layers and len(layers) == len(config.get("rootfs", {}).get("diff_ids", [])), "OCI rootfs layers mismatch.")
    for item in layers:
        descriptor(layout, item)
        require(
            item.get("mediaType") in {LAYER, "application/vnd.docker.image.rootfs.diff.tar.gzip"},
            "This cloud uploader requires existing gzip OCI layers; rebuild unsupported layer compression.",
        )
    # Preserve every compressed layer and the exact config/diff_ids. Only the small manifest is canonicalized.
    manifest = {
        "schemaVersion": 2,
        "mediaType": IMAGE,
        "config": {**manifest["config"], "mediaType": CONFIG},
        "layers": [{"digest": item["digest"], "size": item["size"], "mediaType": LAYER} for item in layers],
    }
    manifest_descriptor = {**store_bytes(layout, encoded(manifest)), "mediaType": IMAGE}
    index = {
        "schemaVersion": 2,
        "mediaType": INDEX,
        "manifests": [{**manifest_descriptor, "platform": {"os": "linux", "architecture": "arm64"}}],
    }
    index_descriptor = {**store_bytes(layout, encoded(index)), "mediaType": INDEX}
    (layout / "oci-layout").write_bytes(encoded({"imageLayoutVersion": "1.0.0"}))
    (layout / "index.json").write_bytes(encoded(index))
    plan = {
        "identity": identity,
        "layout_directory": str(layout),
        "manifest": manifest_descriptor,
        "index": index_descriptor,
        "config": manifest["config"],
        "blobs": [manifest["config"], *manifest["layers"]],
    }
    save(prepared, plan)
    return plan


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def checked_url(value):
    require(isinstance(value, str), "Invalid registry URL.")
    url = ORIGIN + value if value.startswith("/") and not value.startswith("//") else value
    parsed = urllib.parse.urlsplit(url)
    try:
        port = parsed.port
    except ValueError:
        raise RegistryError("Invalid registry URL.") from None
    require(
        parsed.scheme == "https"
        and parsed.hostname == "git.cellnucle.us"
        and port in {None, 443}
        and parsed.username is None
        and parsed.password is None
        and not parsed.fragment
        and urllib.parse.unquote(parsed.path) == parsed.path
        and ".." not in parsed.path.split("/"),
        "Registry requests require the configured HTTPS origin without redirects.",
    )
    return url


class Client:
    def __init__(self, basic=None, *, opener=None):
        self.basic = basic if basic is not None else os.environ.get("CAGELEDGER_GITEA_REGISTRY_BASIC", "")
        require(
            bool(self.basic) and not any(char.isspace() for char in self.basic), "Registry BASIC binding is required."
        )
        self.bearer = None
        self.opener = opener or urllib.request.build_opener(NoRedirect())

    def authenticate(self):
        query = urllib.parse.urlencode(
            {"service": "container_registry", "scope": "repository:hugo/cageledger:pull,push"}
        )
        _, _, body = self._open("GET", "/v2/token?" + query, basic=True)
        value = json.loads(body)
        require(isinstance(value, dict), "Invalid registry token response.")
        token = value.get("token") or value.get("access_token")
        require(
            isinstance(token, str) and token and not any(char.isspace() for char in token),
            "Invalid registry token response.",
        )
        self.bearer = token

    def _open(self, method, value, *, body=None, headers=None, basic=False):
        url = checked_url(value)
        path = urllib.parse.urlsplit(url).path
        require(
            (basic and method == "GET" and path == "/v2/token") or (not basic and path.startswith(BASE + "/")),
            "Registry authentication scope violation.",
        )
        if not basic and self.bearer is None:
            self.authenticate()
        request_headers = dict(headers or {})
        require(
            not any(key.lower() == "authorization" for key in request_headers),
            "Explicit authentication override refused.",
        )
        request_headers["Authorization"] = ("Basic " + self.basic) if basic else ("Bearer " + self.bearer)
        if body is not None:
            request_headers["Content-Length"] = str(len(body))
        try:
            with self.opener.open(
                urllib.request.Request(url, data=body, headers=request_headers, method=method), timeout=120
            ) as response:
                content = response.read(LIMIT + 1)
                require(len(content) <= LIMIT, "Registry metadata exceeds the response limit.")
                return response.status, response.headers, content
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
            raise HTTPFailure(method, url, status) from None
        except (OSError, urllib.error.URLError):
            raise RegistryError(f"Registry {method} {path}: network request failed; inspect the receipt.") from None

    def request(self, method, url, *, body=None, headers=None, missing=False):
        try:
            return self._open(method, url, body=body, headers=headers)
        except HTTPFailure as error:
            if error.status == 401 and method in {"GET", "HEAD"}:
                self.authenticate()
                try:
                    return self._open(method, url, body=body, headers=headers)
                except HTTPFailure as refreshed:
                    error = refreshed
            if missing and error.status == 404:
                return 404, {}, b""
            raise error from None

    def open_blob(self, value, *, offset=0):
        """Stream an immutable repository blob without the small-metadata buffer."""
        require(bool(re.fullmatch(r"sha256:[0-9a-f]{64}", value)), "Invalid registry blob digest.")
        require(type(offset) is int and offset >= 0, "Invalid registry blob offset.")
        url = checked_url(BASE + "/blobs/" + value)
        for attempt in range(2):
            if self.bearer is None:
                self.authenticate()
            headers = {"Authorization": "Bearer " + self.bearer}
            if offset:
                headers["Range"] = f"bytes={offset}-"
            try:
                return self.opener.open(urllib.request.Request(url, headers=headers, method="GET"), timeout=120)
            except urllib.error.HTTPError as error:
                status = error.code
                error.close()
                if status == 401 and attempt == 0:
                    self.authenticate()
                    continue
                raise HTTPFailure("GET", url, status) from None
            except (OSError, urllib.error.URLError):
                raise RegistryError("Registry blob stream failed; preserve the runtime download state.") from None

    def manifest(self, reference):
        require(
            bool(re.fullmatch(r"(?:sha256:[0-9a-f]{64}|[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})", reference)),
            "Invalid registry reference.",
        )
        status, headers, body = self.request(
            "GET",
            BASE + "/manifests/" + reference,
            headers={
                "Accept": IMAGE
                + ", "
                + INDEX
                + ", application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json"
            },
            missing=True,
        )
        if status == 404:
            return None
        require(status == 200, "Registry manifest read failed.")
        value = "sha256:" + hashlib.sha256(body).hexdigest()
        require(headers.get("Docker-Content-Digest", value) == value, "Remote manifest digest mismatch.")
        return value, json.loads(body)

    def location(self, value):
        result = checked_url(value)
        require(
            urllib.parse.urlsplit(result).path.startswith(BASE + "/blobs/uploads/"),
            "Unexpected registry upload location.",
        )
        require(
            self.basic not in result and (self.bearer is None or self.bearer not in result),
            "Upload location contains credentials.",
        )
        return result


def upload_offset(headers, record):
    value = headers.get("Range", "")
    match = re.fullmatch(r"(?:bytes=)?0-(\d+)", value)
    require(match is not None, "Registry upload status lacks a safe range.")
    end = int(match[1])
    if end == 0 and record.get("offset", 0) == 0 and record.get("status") == "ready":
        return 0
    require(end != 0 or record.get("offset", 0) > 0, "Ambiguous registry upload offset; preserve the owned session.")
    return end + 1


class Publisher:
    def __init__(self, plan, state, client):
        self.plan, self.state, self.client = plan, Path(state), client
        self.layout, self.path = Path(plan["layout_directory"]), self.state / "registry-receipt.json"
        self.data = (
            read_json(self.path) if self.path.exists() else {"identity": plan["identity"], "blobs": {}, "tags": {}}
        )
        require(
            self.data.get("identity") == plan["identity"], "Registry receipt belongs to a different archive/release."
        )

    def save(self):
        save(self.path, self.data)

    def has_blob(self, item):
        status, headers, _ = self.client.request("HEAD", BASE + "/blobs/" + item["digest"], missing=True)
        if status == 404:
            return False
        require(
            status == 200 and headers.get("Docker-Content-Digest") == item["digest"],
            "Remote blob digest mismatch.",
        )
        require(int(headers.get("Content-Length", item["size"])) == item["size"], "Remote blob size mismatch.")
        return True

    def blob(self, item):
        path = descriptor(self.layout, item)
        key = item["digest"]
        if self.has_blob(item):
            self.data["blobs"][key] = {"status": "verified", "size": item["size"]}
            self.save()
            return
        record = self.data["blobs"].get(key, {})
        require(record.get("size", item["size"]) == item["size"], "Blob upload receipt changed.")
        if record.get("location"):
            status, headers, _ = self.client.request("GET", record["location"], missing=True)
            if status == 404:
                record = {}
            else:
                require(status in {202, 204}, "Registry upload status failed.")
                record.update(
                    location=self.client.location(headers.get("Location", record["location"])),
                    offset=upload_offset(headers, record),
                    status="ready",
                )
        if not record.get("location"):
            record = {"size": item["size"], "offset": 0, "status": "starting"}
            self.data["blobs"][key] = record
            self.save()
            status, headers, _ = self.client.request("POST", BASE + "/blobs/uploads/", body=b"")
            require(status == 202, "Registry did not create an upload session.")
            record.update(location=self.client.location(headers.get("Location", "")), status="ready")
        self.data["blobs"][key] = record
        self.save()
        with path.open("rb") as stream:
            require(0 <= record["offset"] <= item["size"], "Registry upload offset exceeds the blob.")
            stream.seek(record["offset"])
            while block := stream.read(CHUNK):
                start, end = record["offset"], record["offset"] + len(block)
                record.update(status="patch_pending", pending_end=end)
                self.save()
                status, headers, _ = self.client.request(
                    "PATCH",
                    record["location"],
                    body=block,
                    headers={"Content-Type": "application/octet-stream", "Content-Range": f"{start}-{end - 1}"},
                )
                require(status == 202, "Registry blob chunk was not acknowledged.")
                require(upload_offset(headers, {"offset": end}) == end, "Registry chunk range mismatch.")
                record.update(
                    location=self.client.location(headers.get("Location", record["location"])),
                    offset=end,
                    status="ready",
                )
                self.save()
        record["status"] = "put_pending"
        self.save()
        location = urllib.parse.urlsplit(record["location"])
        query = urllib.parse.parse_qsl(location.query, keep_blank_values=True)
        query = [(name, value) for name, value in query if name != "digest"] + [("digest", key)]
        target = urllib.parse.urlunsplit(location._replace(query=urllib.parse.urlencode(query)))
        status, _, _ = self.client.request("PUT", target, body=b"")
        require(status == 201 and self.has_blob(item), "Registry did not verify the complete blob.")
        self.data["blobs"][key] = {"status": "verified", "size": item["size"]}
        self.save()

    def tag(self, reference, item):
        local = descriptor(self.layout, item)
        prior = self.data["tags"].get(reference)
        remote = self.client.manifest(reference)
        expected = {"digest": item["digest"], "mediaType": item["mediaType"]}
        if remote is not None:
            require(
                prior is not None and prior.get("intent") == expected and remote[0] == item["digest"],
                "Unknown or conflicting existing registry tag; it was not overwritten.",
            )
        else:
            require(not prior or prior.get("status") != "verified", "Previously verified registry tag disappeared.")
            self.data["tags"][reference] = {"intent": expected, "status": "put_pending"}
            self.save()
            status, _, _ = self.client.request(
                "PUT",
                BASE + "/manifests/" + reference,
                body=local.read_bytes(),
                headers={"Content-Type": item["mediaType"], "If-None-Match": "*"},
            )
            require(status == 201, "Registry manifest publication failed.")
            remote = self.client.manifest(reference)
            require(remote is not None and remote[0] == item["digest"], "Published registry manifest differs.")
        self.data["tags"][reference] = {"intent": expected, "status": "verified"}
        self.save()

    def verify_remote(self):
        version, revision = self.plan["identity"]["version"], self.plan["identity"]["revision"]
        child, index = self.client.manifest(version + "-arm64"), self.client.manifest(version)
        require(
            child
            and child[0] == self.plan["manifest"]["digest"]
            and index
            and index[0] == self.plan["index"]["digest"],
            "Final registry version manifest differs.",
        )
        require(
            index[1].get("manifests")
            == [{**self.plan["manifest"], "platform": {"os": "linux", "architecture": "arm64"}}],
            "Registry version index is not the exact ARM64-only index.",
        )
        config = child[1].get("config", {})
        require(config == self.plan["config"], "Remote registry config descriptor changed.")
        status, _, body = self.client.request("GET", BASE + "/blobs/" + config["digest"])
        require(
            status == 200
            and len(body) == config["size"]
            and "sha256:" + hashlib.sha256(body).hexdigest() == config["digest"],
            "Remote registry config bytes differ.",
        )
        check_config(json.loads(body), version, revision)
        require(all(self.has_blob(item) for item in self.plan["blobs"]), "Final registry layer is missing.")

    def publish(self, *, update_latest=False, release=None):
        self.data["status"] = "running"
        self.save()
        version = self.plan["identity"]["version"]
        for reference, item in ((version + "-arm64", self.plan["manifest"]), (version, self.plan["index"])):
            remote = self.client.manifest(reference)
            prior = self.data["tags"].get(reference)
            if remote is not None:
                require(
                    prior
                    and prior.get("intent") == {"digest": item["digest"], "mediaType": item["mediaType"]}
                    and remote[0] == item["digest"],
                    "Unknown or conflicting existing registry tag; it was not overwritten.",
                )
        if update_latest:
            require(
                isinstance(release, dict)
                and release.get("tag_name") == "v" + version
                and release.get("draft") is False
                and release.get("prerelease") is False
                and release.get("target_commitish") == self.plan["identity"]["revision"],
                "Updating latest requires the matching published Gitea Release.",
            )
        for item in self.plan["blobs"]:
            self.blob(item)
        self.tag(version + "-arm64", self.plan["manifest"])
        self.tag(version, self.plan["index"])
        self.verify_remote()
        if update_latest:
            require(
                isinstance(release, dict)
                and release.get("tag_name") == "v" + version
                and release.get("draft") is False
                and release.get("prerelease") is False
                and release.get("target_commitish") == self.plan["identity"]["revision"],
                "Updating latest requires the matching published Gitea Release.",
            )
            remote = self.client.manifest("latest")
            prior = self.data.get("latest_intent")
            if prior is None:
                self.data["latest_intent"] = {
                    "before": remote[0] if remote else None,
                    "after": self.plan["index"]["digest"],
                }
                self.save()
            else:
                require(prior["after"] == self.plan["index"]["digest"], "Latest intent belongs to another release.")
            allowed = {self.data["latest_intent"]["before"], self.plan["index"]["digest"]}
            require((remote[0] if remote else None) in allowed, "Registry latest changed outside this publication.")
            if remote is None or remote[0] != self.plan["index"]["digest"]:
                status, _, _ = self.client.request(
                    "PUT",
                    BASE + "/manifests/latest",
                    body=descriptor(self.layout, self.plan["index"]).read_bytes(),
                    headers={"Content-Type": INDEX},
                )
                require(status == 201, "Registry latest update failed.")
            latest = self.client.manifest("latest")
            require(latest and latest[0] == self.plan["index"]["digest"], "Registry latest verification failed.")
        self.data["status"] = "verified"
        self.data["latest_updated"] = update_latest
        self.save()
        return self.path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--update-latest", action="store_true")
    options = parser.parse_args()
    source = source_identity(ROOT, check_remote=True)
    plan = prepare_archive(options.archive, options.state_dir, source["app_version"], source["revision"])
    value = ReleaseAssets().find("v" + source["app_version"]) if options.update_latest else None
    path = Publisher(plan, options.state_dir, Client()).publish(update_latest=options.update_latest, release=value)
    print("Verified Gitea Container Package publication: " + source["app_version"] + " (linux/arm64)")
    print("Receipt: " + str(path))


if __name__ == "__main__":
    try:
        main()
    except (RegistryError, OSError, ValueError, KeyError, TypeError, tarfile.TarError):
        raise SystemExit(
            "Registry publication stopped. Preserve its receipt and inspect authentication, archive or remote state."
        ) from None
