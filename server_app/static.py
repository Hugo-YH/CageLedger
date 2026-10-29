import gzip
import mimetypes
import threading
from http import HTTPStatus
from pathlib import Path
from urllib.parse import unquote, urlparse

from server_app.config import ROOT

STATIC_CACHE = {}
STATIC_CACHE_LOCK = threading.Lock()


def is_private_frontend_path(path):
    parts = Path(unquote(urlparse(path).path).lstrip("/")).parts
    return any(part.startswith(".") for part in parts) or bool(
        parts and parts[0] in {"data", "server_app", "scripts", "node_modules", "tests"}
    )


def _send_static_file(handler, target: Path) -> bool:
    if not target.is_file():
        return False
    try:
        target = target.resolve()
    except OSError:
        return False
    stat = target.stat()
    accepts_gzip = "gzip" in handler.headers.get("Accept-Encoding", "").lower()
    use_gzip = accepts_gzip and stat.st_size >= 1024
    encoding = "gzip" if use_gzip else "identity"
    etag = f'W/"{stat.st_mtime_ns:x}-{stat.st_size:x}-{encoding}"'
    if handler.headers.get("If-None-Match") == etag:
        handler.send_response(HTTPStatus.NOT_MODIFIED)
        handler.send_header("ETag", etag)
        handler.end_headers()
        return True

    compressed_target = target.with_name(f"{target.name}.gz")
    use_precompressed = (
        use_gzip and compressed_target.is_file() and compressed_target.stat().st_mtime_ns >= stat.st_mtime_ns
    )
    compressed_stat = compressed_target.stat() if use_precompressed else None
    cache_key = (
        str(target),
        stat.st_mtime_ns,
        stat.st_size,
        encoding,
        compressed_stat.st_mtime_ns if compressed_stat else None,
        compressed_stat.st_size if compressed_stat else None,
    )
    with STATIC_CACHE_LOCK:
        body = STATIC_CACHE.get(cache_key)
    if body is None:
        if use_precompressed:
            body = compressed_target.read_bytes()
        else:
            raw = target.read_bytes()
            body = gzip.compress(raw, compresslevel=6) if use_gzip else raw
        with STATIC_CACHE_LOCK:
            if len(STATIC_CACHE) >= 64:
                STATIC_CACHE.clear()
            STATIC_CACHE[cache_key] = body

    content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    if content_type.startswith("text/") or content_type in {
        "application/javascript",
        "application/json",
        "image/svg+xml",
    }:
        content_type = f"{content_type}; charset=utf-8"
    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("ETag", etag)
    handler.send_header("Vary", "Accept-Encoding")
    if use_gzip:
        handler.send_header("Content-Encoding", "gzip")
    handler.end_headers()
    if not getattr(handler, "_head_only", False):
        handler.wfile.write(body)
    return True


def send_frontend_asset(handler, root: Path) -> bool:
    request_path = unquote(urlparse(handler.path).path)
    relative = request_path.lstrip("/")
    if not relative or relative.endswith("/") or relative.endswith(".gz"):
        return False
    parts = Path(relative).parts
    if is_private_frontend_path(handler.path):
        return False
    if root.resolve() == ROOT.resolve() and relative != "index.html" and parts[0] != "assets":
        # A missing production build must never expose the source checkout.
        return False
    if Path(relative).suffix.lower() in {".py", ".pyc", ".sqlite", ".db", ".key", ".pem", ".toml", ".yml", ".yaml"}:
        return False
    try:
        target = (root / relative).resolve()
        target.relative_to(root.resolve())
    except (ValueError, OSError):
        return False
    return _send_static_file(handler, target)


def send_documentation_asset(handler, root: Path) -> bool:
    """Serve VitePress output from the same origin under /docs/.

    VitePress clean URLs map to generated HTML files. Resolving both explicit
    assets and clean route paths keeps direct links, browser refreshes and
    deployment behind a reverse proxy consistent.
    """

    request_path = unquote(urlparse(handler.path).path)
    if request_path not in {"/docs", "/docs/"} and not request_path.startswith("/docs/"):
        return False

    docs_root = (root / "docs").resolve()
    if not docs_root.is_dir():
        return False
    relative = request_path.removeprefix("/docs").lstrip("/")
    candidates = ["index.html"] if not relative else [relative, f"{relative}.html", f"{relative}/index.html"]
    for candidate in candidates:
        try:
            target = (docs_root / candidate).resolve()
            target.relative_to(docs_root)
        except (ValueError, OSError):
            continue
        if _send_static_file(handler, target):
            return True
    return False
