"""Stable input inventories and exclusive, byte-for-byte private copies."""

import hashlib
import os
import stat
from pathlib import Path, PurePosixPath


def safe_input(path, *, directory=False):
    path = Path(path).absolute()
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise ValueError("输入路径不能含符号链接")
    path = path.resolve(strict=True)
    if not (path.is_dir() if directory else path.is_file()):
        raise ValueError("输入必须是普通目录或文件")
    return path


def relative_path(value):
    value = str(value)
    path = PurePosixPath(value)
    if not value or "\\" in value or path.is_absolute() or any(p in {"", ".", ".."} for p in value.split("/")):
        raise ValueError("附件路径必须是安全的相对路径")
    return path


def file_fact(path):
    # NOFOLLOW also guards a file replaced with a symlink after enumeration.
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("备份中不能包含符号链接或特殊文件")
        sha = hashlib.file_digest(stream, "sha256").hexdigest()
        after = os.fstat(stream.fileno())
        current = Path(path).lstat()
        keys = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        if any(
            getattr(before, key) != getattr(after, key) or getattr(after, key) != getattr(current, key) for key in keys
        ):
            raise ValueError("读取期间输入文件发生变化")
    return {"bytes": after.st_size, "sha256": sha}


def inventory(root):
    root = safe_input(root, directory=True)
    result = {"directories": [], "files": {}}

    def walk(folder):
        with os.scandir(folder) as entries:
            names = sorted(entries, key=lambda entry: entry.name)
        for entry in names:
            name = Path(entry.path).relative_to(root).as_posix()
            relative_path(name)
            if entry.is_symlink():
                raise ValueError("附件目录不能包含符号链接")
            if entry.is_dir(follow_symlinks=False):
                result["directories"].append(name)
                walk(Path(entry.path))
            elif entry.is_file(follow_symlinks=False):
                result["files"][name] = file_fact(entry.path)
            else:
                raise ValueError("附件目录不能包含特殊文件")

    walk(root)
    return result


def copy_file(source, target, expected):
    source, target = Path(source), Path(target)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as original, target.open("xb") as copied:
        if not stat.S_ISREG(os.fstat(original.fileno()).st_mode):
            raise ValueError("只能复制普通文件")
        os.chmod(target, 0o600)
        while chunk := original.read(1024 * 1024):
            copied.write(chunk)
    if file_fact(target) != expected:
        raise ValueError("复制后文件与清单不一致")


def copy_tree(source, target, manifest):
    target = Path(target)
    target.mkdir(mode=0o700)
    for name in manifest["directories"]:
        (target / str(relative_path(name))).mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, expected in manifest["files"].items():
        name = str(relative_path(name))
        copy_file(Path(source) / name, target / name, expected)
    if inventory(target) != manifest:
        raise ValueError("恢复后的完整附件目录与清单不一致")
