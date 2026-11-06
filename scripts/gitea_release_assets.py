"""Verified same-origin Gitea draft-release transport with bounded multipart streams."""

import hashlib
import http.client
import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from uuid import UUID, uuid4

ORIGIN = "https://git.cellnucle.us"
REPOSITORY = "hugo/cageledger"
API = f"/api/v1/repos/{REPOSITORY}"
BLOCK = 64 * 1024
MAX_METADATA = 8 * 1024 * 1024


class AssetError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise AssetError(message)


def checked_url(value):
    url = ORIGIN + value if value.startswith("/") and not value.startswith("//") else value
    parsed = urllib.parse.urlsplit(url)
    try:
        port = parsed.port
    except ValueError:
        raise AssetError("Invalid Gitea URL.") from None
    require(
        parsed.scheme == "https"
        and parsed.hostname == "git.cellnucle.us"
        and port in {None, 443}
        and parsed.username is None
        and parsed.password is None
        and not parsed.fragment,
        "Release requests require the configured HTTPS Gitea origin; redirects are not followed.",
    )
    return url


class HTTPFailure(AssetError):
    def __init__(self, method, url, code, location=None):
        self.code = code
        self.location = location
        super().__init__(f"Gitea {method} {urllib.parse.urlsplit(url).path}: HTTP {code}")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class MultipartFile:
    """http.client reads this file-like body in blocks; length includes framing."""

    def __init__(self, path, boundary=None):
        path = Path(path)
        require(not any(char in path.name for char in '\r\n"'), "Invalid attachment filename.")
        self.boundary = boundary or "cageledger-" + uuid4().hex
        prefix = (
            f"--{self.boundary}\r\n"
            f'Content-Disposition: form-data; name="attachment"; filename="{path.name}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode()
        suffix = f"\r\n--{self.boundary}--\r\n".encode()
        self.size = len(prefix) + path.stat().st_size + len(suffix)
        self.file = path.open("rb")
        self.parts = [io.BytesIO(prefix), self.file, io.BytesIO(suffix)]
        self.part = 0

    def read(self, size=-1):
        remaining = BLOCK if size < 0 else min(size, BLOCK)
        chunks = []
        while remaining and self.part < len(self.parts):
            chunk = self.parts[self.part].read(remaining)
            if not chunk:
                self.part += 1
                continue
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def __enter__(self):
        return self

    def __exit__(self, *arguments):
        self.file.close()


class ReleaseAssets:
    def __init__(self, token=None, *, opener=None, anonymous_opener=None):
        token = token if token is not None else os.environ.get("CAGELEDGER_GITEA_TOKEN", "")
        require(
            bool(token) and not any(char.isspace() for char in token),
            "A valid Gitea network token binding is required.",
        )
        self.authorization = "token " + token
        # Default ProxyHandler/verified HTTPSHandler retain the session proxy and CA trust.
        self.opener = opener or urllib.request.build_opener(NoRedirect())
        self.anonymous_opener = anonymous_opener or urllib.request.build_opener(NoRedirect())
        self._release_tags = {}

    def open(self, method, url, *, body=None, headers=None, authenticated=True):
        url = checked_url(url)
        request_headers = {"Accept": "application/json"}
        request_headers.update(headers or {})
        if authenticated:
            request_headers["Authorization"] = self.authorization
        else:
            require(
                not any(key.lower() == "authorization" for key in request_headers),
                "Anonymous probe cannot use authentication.",
            )
        request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
        try:
            return (self.opener if authenticated else self.anonymous_opener).open(request, timeout=120)
        except urllib.error.HTTPError as error:
            code, location = error.code, error.headers.get("Location") if error.headers else None
            error.close()
            raise HTTPFailure(method, url, code, location) from None
        except (OSError, urllib.error.URLError, http.client.HTTPException):
            raise AssetError(
                f"Gitea {method} {urllib.parse.urlsplit(url).path}: network request failed; inspect the receipt."
            ) from None

    def json(self, method, path, *, value=None, missing=False):
        encoded = json.dumps(value).encode() if value is not None else None
        headers = (
            {"Content-Type": "application/json", "Content-Length": str(len(encoded))} if encoded is not None else None
        )
        try:
            with self.open(method, path, body=encoded, headers=headers) as response:
                body = response.read(MAX_METADATA + 1)
                require(len(body) <= MAX_METADATA, "Release metadata exceeds the response limit.")
        except HTTPFailure as error:
            if missing and error.code == 404:
                return None
            raise
        try:
            return json.loads(body)
        except (ValueError, TypeError):
            raise AssetError("Invalid release metadata response.") from None

    def repository(self):
        value = self.json("GET", API)
        require(
            isinstance(value, dict)
            and type(value.get("id")) is int
            and value.get("full_name") == REPOSITORY
            and value.get("private") is True
            and value.get("permissions", {}).get("push") is True,
            "Delivery requires verified push access to the private hugo/cageledger repository.",
        )
        return value["id"]

    def actor(self):
        value = self.json("GET", "/api/v1/user")
        require(
            isinstance(value, dict) and type(value.get("id")) is int and isinstance(value.get("login"), str),
            "Invalid Gitea actor metadata.",
        )
        return {"id": value["id"], "login": value["login"]}

    def find(self, tag):
        return self.json("GET", f"{API}/releases/tags/{urllib.parse.quote(tag, safe='')}", missing=True)

    def create(self, payload):
        return self.json("POST", f"{API}/releases", value=payload)

    def release(self, release_id):
        return self.json("GET", f"{API}/releases/{release_id}")

    @staticmethod
    def attachment(value):
        require(
            isinstance(value, dict)
            and type(value.get("id")) is int
            and isinstance(value.get("name"), str)
            and type(value.get("size")) is int
            and value["size"] >= 0
            and isinstance(value.get("browser_download_url"), str),
            "Invalid release attachment metadata.",
        )
        checked_url(value["browser_download_url"])
        require(
            not urllib.parse.urlsplit(value["browser_download_url"]).query,
            "Attachment URLs must not contain credentials or access tokens.",
        )
        return value

    def assets(self, release_id):
        values = self.json("GET", f"{API}/releases/{release_id}/assets")
        require(isinstance(values, list), "Invalid release attachment list.")
        result = {}
        for value in values:
            value = self.attachment(value)
            require(value["name"] not in result, "Duplicate immutable release attachment name.")
            result[value["name"]] = value
        return result

    def _release_tag(self, release_id):
        if release_id not in self._release_tags:
            value = self.release(release_id)
            require(
                isinstance(value, dict)
                and type(value.get("id")) is int
                and value["id"] == release_id
                and isinstance(value.get("tag_name"), str)
                and bool(value["tag_name"]),
                "Invalid release metadata for attachment association.",
            )
            self._release_tags[release_id] = value["tag_name"]
        return self._release_tags[release_id]

    def upload(self, release_id, artifact):
        query = urllib.parse.urlencode({"name": artifact.path.name})
        with MultipartFile(artifact.path) as body:
            headers = {
                "Content-Type": f"multipart/form-data; boundary={body.boundary}",
                "Content-Length": str(body.size),
            }
            with self.open(
                "POST", f"{API}/releases/{release_id}/assets?{query}", body=body, headers=headers
            ) as response:
                content = response.read(MAX_METADATA + 1)
                require(len(content) <= MAX_METADATA, "Attachment response exceeds the metadata limit.")
        try:
            uploaded = self.attachment(json.loads(content))
        except (ValueError, TypeError):
            raise AssetError("Invalid uploaded attachment metadata.") from None
        require(
            uploaded["name"] == artifact.path.name and uploaded["size"] == artifact.path.stat().st_size,
            "Uploaded attachment size/name differs from the original file.",
        )
        identity = uploaded.get("uuid")
        require(isinstance(identity, str), "Uploaded attachment UUID is missing.")
        try:
            require(str(UUID(identity)) == identity, "Uploaded attachment UUID is invalid.")
        except ValueError:
            raise AssetError("Uploaded attachment UUID is invalid.") from None
        tag = urllib.parse.quote(self._release_tag(release_id), safe="")
        name = urllib.parse.quote(uploaded["name"], safe="")
        canonical = f"{ORIGIN}/{REPOSITORY}/releases/download/{tag}/{name}"
        require(
            uploaded["browser_download_url"] in {f"{ORIGIN}/attachments/{identity}", canonical},
            "Unsupported uploaded attachment URL; immutable identity was not normalized.",
        )
        # Preserve every other field; the first SHA read now uses the final URL.
        return {**uploaded, "browser_download_url": canonical}

    def digest(self, attachment):
        attachment = self.attachment(attachment)
        digest = hashlib.sha256()
        size = 0
        with self.open("GET", attachment["browser_download_url"]) as response:
            require(response.status == 200, "Attachment download did not return a complete file.")
            while block := response.read(BLOCK):
                size += len(block)
                require(size <= attachment["size"], "Attachment download exceeds its declared size.")
                digest.update(block)
        require(size == attachment["size"], "Attachment download was incomplete.")
        return digest.hexdigest()

    def verify(self, attachment, artifact):
        require(
            attachment["name"] == artifact.path.name and attachment["size"] == artifact.size,
            "Immutable attachment size/name conflict; not overwritten.",
        )
        require(self.digest(attachment) == artifact.sha256, "Immutable attachment SHA256 conflict; not overwritten.")

    def anonymous_denied(self, attachment):
        url = self.attachment(attachment)["browser_download_url"]
        try:
            with self.open("GET", url, authenticated=False) as response:
                # Any success means a real raw attachment request was allowed; never infer privacy from APIv1.
                raise AssetError(
                    f"Raw release attachment is anonymously accessible (HTTP {response.status}); source upload refused."
                )
        except HTTPFailure as error:
            if error.code in {401, 403, 404}:
                return {"status": error.code, "raw_attachment_access": "denied"}
            if error.code in {301, 302, 303, 307, 308} and error.location:
                location = urllib.parse.urljoin(url, error.location)
                checked_url(location)
                if urllib.parse.urlsplit(location).path.rstrip("/") == "/user/login":
                    return {"status": error.code, "raw_attachment_access": "same_origin_login"}
            raise AssetError("Anonymous raw attachment access was not safely denied; source upload refused.") from None


def download_script(tag, revision, manifest_name, manifest_sha256, *, official=False):
    """Self-contained Python 3 downloader; only public identifiers are substituted."""
    template = r'''#!/usr/bin/env python3
"""Run: python3 CageLedger-download.py.txt --directory ./CageLedger-download
The token is read from CAGELEDGER_GITEA_TOKEN or a hidden prompt, never from argv
or a file. Binary .partNNNN.gz files must be concatenated, not individually
unpacked. This script downloads and verifies files; it does not deploy software.
"""
import argparse
import getpass
import hashlib
import json
import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ORIGIN = "https://git.cellnucle.us"
API = ORIGIN + "/api/v1/repos/hugo/cageledger"
TAG = @TAG@
REVISION = @REVISION@
MANIFEST = @MANIFEST@
MANIFEST_SHA256 = @MANIFEST_SHA256@
OFFICIAL = @OFFICIAL@
BLOCK = 65536


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def safe_url(url):
    value = urllib.parse.urlsplit(url)
    try:
        port = value.port
    except ValueError:
        raise RuntimeError("Invalid attachment URL.") from None
    require(value.scheme == "https" and value.hostname == "git.cellnucle.us"
            and port in (None, 443) and value.username is None
            and value.password is None and not value.fragment and not value.query,
            "Attachment URL must use the configured HTTPS Gitea host.")
    return url


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def open_url(url, opener, token):
    safe_url(url)
    request = urllib.request.Request(url, headers={"Authorization": "token " + token})
    try:
        return opener.open(request, timeout=120)
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
        raise RuntimeError("Download request failed: HTTP " + str(code)) from None
    except OSError:
        raise RuntimeError("Download request failed; verified existing files can be reused on the next run.") from None


def get_json(url, opener, token):
    with open_url(url, opener, token) as response:
        body = response.read(8 * 1024 * 1024 + 1)
    require(len(body) <= 8 * 1024 * 1024, "Metadata is unexpectedly large.")
    return json.loads(body)


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while True:
            block = source.read(BLOCK)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def existing(path, size, sha256):
    if path.exists() or path.is_symlink():
        require(path.is_file() and not path.is_symlink()
                and path.stat().st_size == size and file_hash(path) == sha256,
                "Existing file differs; preserve it and choose another directory: " + path.name)
        return True
    return False


def name_path(directory, name):
    require(isinstance(name, str) and name not in ("", ".", "..")
            and Path(name).name == name and "/" not in name and "\\" not in name,
            "Unsafe attachment filename.")
    return directory / name


def download(asset, metadata, directory, opener, token):
    name, size, sha256 = metadata["name"], metadata["size"], metadata["sha256"]
    path = name_path(directory, name)
    require(asset["name"] == name and asset["size"] == size, "Attachment metadata mismatch.")
    if existing(path, size, sha256):
        print("verified existing: " + name, flush=True)
        return path
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=directory, prefix=".download-", delete=False) as target:
            temporary = Path(target.name)
            digest, count = hashlib.sha256(), 0
            with open_url(asset["browser_download_url"], opener, token) as response:
                require(response.status == 200, "Complete attachment download was not returned.")
                while True:
                    block = response.read(BLOCK)
                    if not block:
                        break
                    count += len(block)
                    require(count <= size, "Attachment exceeds its expected size.")
                    digest.update(block)
                    target.write(block)
        require(count == size and digest.hexdigest() == sha256, "Attachment SHA256 mismatch: " + name)
        require(not path.exists() and not path.is_symlink(), "Download target appeared during transfer; not overwritten.")
        temporary.replace(path)
        print("downloaded and verified: " + name, flush=True)
        return path
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def restore(record, directory):
    output = name_path(directory, record["name"])
    if existing(output, record["size"], record["sha256"]):
        return
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=directory, prefix=".restore-", delete=False) as target:
            temporary = Path(target.name)
            digest, count = hashlib.sha256(), 0
            for piece in record["attachments"]:
                path = name_path(directory, piece["name"])
                require(existing(path, piece["size"], piece["sha256"]), "Required chunk is missing.")
                with path.open("rb") as source:
                    while True:
                        block = source.read(BLOCK)
                        if not block:
                            break
                        digest.update(block)
                        target.write(block)
                        count += len(block)
        require(count == record["size"] and digest.hexdigest() == record["sha256"], "Restored archive SHA256 mismatch.")
        require(not output.exists() and not output.is_symlink(), "Restore target appeared; not overwritten.")
        temporary.replace(output)
        print("restored and verified: " + output.name, flush=True)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("CageLedger-" + TAG))
    options = parser.parse_args()
    token = os.environ.get("CAGELEDGER_GITEA_TOKEN") or getpass.getpass("Gitea personal access token: ")
    require(bool(token) and not any(c.isspace() for c in token), "A valid token is required.")
    opener = urllib.request.build_opener(NoRedirect())
    release = get_json(API + "/releases/tags/" + urllib.parse.quote(TAG, safe=""), opener, token)
    require(release.get("tag_name") == TAG and release.get("target_commitish") == REVISION
            and ((OFFICIAL and type(release.get("draft")) is bool and release.get("prerelease") is False)
                 or (not OFFICIAL and release.get("draft") is True and release.get("prerelease") is True)),
            "Release identity differs from this build.")
    values = get_json(API + "/releases/" + str(release["id"]) + "/assets", opener, token)
    assets = {}
    for asset in values:
        name = asset["name"]
        require(name not in assets, "Duplicate attachment filename.")
        safe_url(asset["browser_download_url"])
        assets[name] = asset
    require(MANIFEST in assets and assets[MANIFEST]["size"] <= 8 * 1024 * 1024, "Build manifest is missing or too large.")
    directory = options.directory.expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=True)
    manifest_path = download(assets[MANIFEST], {"name": MANIFEST, "size": assets[MANIFEST]["size"], "sha256": MANIFEST_SHA256}, directory, opener, token)
    manifest = json.loads(manifest_path.read_text())
    require(manifest["source"]["revision"] == REVISION and manifest["platforms"] == ["linux/arm64"], "Manifest identity differs.")
    recovery = manifest["recovery"]
    download(assets[recovery["name"]], recovery, directory, opener, token)
    for record in manifest["artifacts"]:
        for piece in record["attachments"]:
            require(piece["name"] in assets, "Required attachment is missing: " + piece["name"])
            download(assets[piece["name"]], piece, directory, opener, token)
        restore(record, directory)
    print("All selected ARM64 delivery archives were restored and SHA256 verified. No deployment was performed."
          if OFFICIAL else "All source and ARM64 archives were restored and SHA256 verified. No deployment was performed.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, TypeError):
        raise SystemExit("Download stopped. Preserve existing files and check permissions, attachment completeness, or SHA256 results.") from None
'''
    for key, value in {
        "@TAG@": tag,
        "@REVISION@": revision,
        "@MANIFEST@": manifest_name,
        "@MANIFEST_SHA256@": manifest_sha256,
        "@OFFICIAL@": official,
    }.items():
        template = template.replace(key, repr(value) if key == "@OFFICIAL@" else json.dumps(value))
    return template.encode()
