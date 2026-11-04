"""Reuse verified developer-local converter media without installing applications."""

import fcntl
import hashlib
import json
import os
import plistlib
import re
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path

from release_runtime import command, require


def cached_converter(tools):
    candidates = []
    for metadata in tools.glob("libreoffice-*.json"):
        value = json.loads(metadata.read_text())
        version = value.get("version", "")
        if re.fullmatch(r"\d+\.\d+\.\d+", version):
            candidates.append((tuple(map(int, version.split("."))), value))
    if not candidates:
        return None
    value = max(candidates, key=lambda item: item[0])[1]
    image = Path(value["image"]).resolve()
    require(image.is_relative_to(tools) and image.is_file(), "缓存转换器镜像必须在发布工具目录内。")
    expected = value.get("sha256", "")
    require(bool(re.fullmatch(r"[0-9a-f]{64}", expected)), "缓存转换器缺少 SHA256 元数据。")
    with image.open("rb") as source:
        require(hashlib.file_digest(source, "sha256").hexdigest() == expected, "缓存转换器镜像 SHA256 不匹配。")
    mount = Path(value.get("mount", tools / "mounted-libreoffice")).resolve()
    require(mount.is_relative_to(tools) and mount != tools, "缓存转换器挂载点必须在发布工具目录内。")
    return image, mount


def mounted_image(mount):
    result = subprocess.run(["hdiutil", "info", "-plist"], capture_output=True, timeout=15, check=True)
    for image in plistlib.loads(result.stdout).get("images", []):
        if any(entity.get("mount-point") == str(mount) for entity in image.get("system-entities", [])):
            return Path(image["image-path"]).resolve()
    return None


@contextmanager
def release_converter(repo):
    # Explicit paths stay authoritative, including failures; do not hide a typo by
    # silently choosing another converter. A mounted bundle is validated later.
    if sys.platform != "darwin" or os.environ.get("CAGELEDGER_LIBREOFFICE_BIN", "").strip():
        yield
        return
    installed = Path("/Applications/LibreOffice.app/Contents/MacOS/soffice")
    if installed.is_file():
        os.environ["CAGELEDGER_LIBREOFFICE_BIN"] = str(installed)
        try:
            yield
        finally:
            os.environ.pop("CAGELEDGER_LIBREOFFICE_BIN", None)
        return
    tools = (
        Path(os.environ.get("CAGELEDGER_RELEASE_TOOLS_DIR", repo / ".codex-run/release-tools")).expanduser().resolve()
    )
    if not tools.is_dir():
        yield
        return
    with (tools / ".converter.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("另一个发布任务正在使用此转换器缓存；请等待结束后重试。") from None
        cached = cached_converter(tools)
        if cached is None:
            yield
            return
        # Stable path preserves valid runtime receipts across same-version resumes.
        image, mount = cached
        existing = mounted_image(mount)
        owned = False
        device = None
        try:
            if existing:
                require(existing == image, "发布转换器挂载点属于其他镜像，未执行替换。")
            else:
                mount.mkdir(exist_ok=True)
                require(not any(mount.iterdir()), "发布转换器挂载点非空，未执行挂载。")
                print("[release] 只读挂载开发目录中的 LibreOffice 缓存", flush=True)
                output = command(
                    ["hdiutil", "attach", "-readonly", "-nobrowse", "-plist", "-mountpoint", str(mount), str(image)],
                    repo,
                    timeout=60,
                )
                owned = True
                entities = plistlib.loads(output.encode())["system-entities"]
                device = next(entity["dev-entry"] for entity in entities if entity.get("mount-point") == str(mount))
            binary = mount / "LibreOffice.app/Contents/MacOS/soffice"
            require(binary.is_file(), "缓存镜像中未找到正式 LibreOffice 应用。")
            os.environ["CAGELEDGER_LIBREOFFICE_BIN"] = str(binary)
            yield
        finally:
            os.environ.pop("CAGELEDGER_LIBREOFFICE_BIN", None)
            if owned:
                # Only eject a mount created by this invocation, never an explicit
                # user-supplied mount; do not force-close another process's files.
                try:
                    command(["diskutil", "eject", device or str(mount)], repo, timeout=30)
                    print("[release] 临时转换器已卸载，安装包继续保留", flush=True)
                except (OSError, RuntimeError, subprocess.SubprocessError):
                    print(f"[release] 转换器挂载点仍保留，请在使用结束后卸载：{mount}", flush=True)
