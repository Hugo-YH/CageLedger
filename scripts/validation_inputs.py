"""Metadata signatures for trusted local tool installations; no repeated bundle byte scans."""

import json
import os
from hashlib import sha256
from pathlib import Path


def hashed(value):
    return sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def metadata(path):
    """Detect installed-tool changes without repeatedly reading gigabytes of bundles."""
    path = Path(path)
    if not path.exists():
        return "missing"
    paths = [path, *sorted(path.rglob("*"))] if path.is_dir() else [path]
    result = {}
    for item in paths:
        if "__pycache__" in item.parts or item.suffix == ".pyc":
            continue
        info = item.lstat()
        # Directory contents are represented by the complete entry list; importing a
        # dependency may create an ignored __pycache__ without changing that tool.
        volatile = (None, None, None) if item.is_dir() else (info.st_size, info.st_mtime_ns, info.st_ctime_ns)
        target = None
        if item.is_symlink():
            try:
                resolved = item.stat()
                target = [
                    resolved.st_dev,
                    resolved.st_ino,
                    resolved.st_size,
                    resolved.st_mtime_ns,
                    resolved.st_ctime_ns,
                ]
            except FileNotFoundError:
                target = "missing"
        result[str(item.relative_to(path))] = [
            info.st_dev,
            info.st_ino,
            info.st_mode,
            *volatile,
            os.readlink(item) if item.is_symlink() else None,
            target,
        ]
    return hashed(result)
