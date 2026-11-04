"""Bounded signing rehearsal and noninteractive release credential diagnostics.

Never creates keys, changes Git/Keychain configuration or prints command output.
Only the already configured SSH identity may be loaded from the login Keychain.
"""

import os
import socket
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path


class CredentialError(RuntimeError):
    pass


@contextmanager
def noninteractive_credentials():
    values = {
        "GIT_TERMINAL_PROMPT": "0",
        "GCM_INTERACTIVE": "Never",
        "GIT_ASKPASS": "/usr/bin/false",
        "SSH_ASKPASS": "/usr/bin/false",
        "SSH_ASKPASS_REQUIRE": "force",
    }
    if not os.environ.get("GIT_SSH_COMMAND") and not os.environ.get("GIT_SSH"):
        values["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes -o ConnectTimeout=10 -o ConnectionAttempts=1"
    previous = {key: os.environ.get(key) for key in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def run(args, cwd, *, timeout=20):
    # Never let inherited Git repository selectors redirect a disposable probe.
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("GIT_")
        or key
        in {
            "GIT_TERMINAL_PROMPT",
            "GIT_ASKPASS",
            "GIT_SSH",
            "GIT_SSH_COMMAND",
        }
    }
    return subprocess.run(
        args, cwd=cwd, env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout, check=False
    )


def config(repo, key, *, path=False):
    args = ["git", "config", "--get", key] if not path else ["git", "config", "--path", "--get", key]
    result = run(args, repo)
    if result.returncode not in (0, 1):
        raise CredentialError(f"无法读取 Git 配置 {key}。")
    return result.stdout.strip()


def signing_config(repo):
    keys = (
        "user.name",
        "user.email",
        "user.signingkey",
        "gpg.format",
        "gpg.program",
        "gpg.openpgp.program",
        "gpg.ssh.program",
        "gpg.ssh.allowedSignersFile",
        "gpg.ssh.revocationFile",
        "gpg.x509.program",
        "gpg.minTrustLevel",
    )
    values = {
        key: config(repo, key, path=key in {"gpg.ssh.allowedSignersFile", "gpg.ssh.revocationFile"}) for key in keys
    }
    if not all(values[key] for key in ("user.name", "user.email", "user.signingkey")):
        raise CredentialError("发布仓库缺少 user.name、user.email 或 user.signingkey。")
    if values["gpg.format"] == "ssh":
        key = Path(values["user.signingkey"]).expanduser()
        if (repo / key).is_file():
            values["user.signingkey"] = str((repo / key).resolve())
        for name in ("gpg.ssh.allowedSignersFile", "gpg.ssh.revocationFile"):
            if values[name]:
                values[name] = str((repo / values[name]).resolve())
        if not values["gpg.ssh.allowedSignersFile"]:
            raise CredentialError("SSH 签名缺少 gpg.ssh.allowedSignersFile，无法验证发布者身份。")
    return {key: value for key, value in values.items() if value}


def signing_rehearsal(repo, values):
    # A real commit and annotated tag in a disposable repository also exercise
    # allowed-signers/principal matching. Source refs, index and objects stay intact.
    with tempfile.TemporaryDirectory(prefix="cageledger-signing-probe-") as directory:
        target = Path(directory)
        result = run(["git", "init", "-q", str(target)], repo)
        if result.returncode:
            raise CredentialError("无法创建临时签名验证仓库。")
        overrides = {
            **values,
            "core.hooksPath": str(target / "no-hooks"),
            "commit.gpgsign": "true",
            "tag.gpgsign": "true",
        }
        git = ["git"]
        for key, value in overrides.items():
            git += ["-c", f"{key}={value}"]
        for step, args in (
            ("sign", ["commit", "--allow-empty", "-S", "-m", "Release signing probe"]),
            ("verify", ["verify-commit", "HEAD"]),
            ("sign", ["tag", "-s", "release-probe", "-m", "Release signing probe"]),
            ("verify", ["verify-tag", "release-probe"]),
        ):
            result = run([*git, *args], target)
            if result.returncode:
                return step
    return None


def agent_available(path):
    if not path:
        return False
    try:
        with socket.socket(socket.AF_UNIX) as probe:
            probe.settimeout(1)
            probe.connect(path)
        return True
    except OSError:
        return False


def recover_ssh_identity(repo, values):
    if sys.platform != "darwin" or values.get("gpg.format") != "ssh":
        return False
    # Reuse the logged-in user's launchd agent only if the inherited socket is dead.
    if not agent_available(os.environ.get("SSH_AUTH_SOCK")):
        result = run(["launchctl", "getenv", "SSH_AUTH_SOCK"], repo, timeout=5)
        candidate = result.stdout.strip() if result.returncode == 0 else ""
        if not agent_available(candidate):
            return False
        os.environ["SSH_AUTH_SOCK"] = candidate
    key = Path(values["user.signingkey"]).expanduser()
    if key.suffix == ".pub":
        key = key.with_suffix("")
    if not key.is_file():
        return False
    result = run(["ssh-add", "--apple-use-keychain", "-q", str(key)], repo, timeout=15)
    return result.returncode == 0


def verify_signing(repo, *, recover=True):
    values = signing_config(repo)
    try:
        failure = signing_rehearsal(repo, values)
        recovered = False
        if failure == "sign" and recover and recover_ssh_identity(repo, values):
            recovered = True
            failure = signing_rehearsal(repo, values)
        if failure == "verify":
            raise CredentialError(
                "签名已生成但验证失败；检查 allowedSignersFile 的邮箱/principal、撤销列表和信任配置。"
            )
        if failure:
            raise CredentialError(
                "签名密钥当前不可用；请在 Mac mini 登录并解锁登录钥匙串，再运行 release:doctor。"
                "无需发送密码，不要关闭签名校验。已有有效门禁结果会保留。"
            )
        return {"commit_verified": True, "tag_verified": True, "agent_recovered": recovered}
    except subprocess.TimeoutExpired:
        raise CredentialError("签名或钥匙串操作超时；请在 Mac mini 检查登录钥匙串，再运行 release:doctor。") from None


def record_signing(journal, enabled):
    selected = "signed" if enabled else "unsigned"
    frozen = any(journal.data.get(key) for key in ("commit_intent", "commit", "release_input"))
    previous = journal.data.get("signing", "signed" if frozen else selected)
    if frozen and previous != selected:
        raise CredentialError(f"此发布已按 {previous} 策略冻结；续跑须使用原策略（签名发布加 --sign）。")
    journal.data["signing"] = selected
    journal.save()
