"""Bounded prerequisite diagnostics, separate from release gates and publication."""

import subprocess
import sys

from release_browsers import pdf_browser
from release_credentials import CredentialError, config, noninteractive_credentials, verify_signing
from release_host_guard import execute
from release_runtime import browser_installations, command, converter_identity, official_origin, require
from release_tools import release_converter


def diagnose(repo, *, sign=False, online=False):
    failures = []

    def check(name, action, remedy):
        print(f"[doctor] 检查 {name}…", flush=True)
        try:
            action()
        except CredentialError as error:
            failures.append(name)
            print(f"[FAIL] {name}：{error}", flush=True)
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.SubprocessError):
            # Helpers may contain private URLs or credential-manager output. Keep
            # diagnostics actionable without printing exceptions or command output.
            failures.append(name)
            print(f"[FAIL] {name}：{remedy}", flush=True)
        else:
            print(f"[OK] {name}", flush=True)

    def node():
        version = command(["node", "-p", "process.versions.node"], repo, timeout=10).split(".")
        require(int(version[0]) == 22 and int(version[1]) >= 12, "Node version")

    def converter():
        with release_converter(repo):
            converter_identity()

    def transport():
        require(official_origin(command(["git", "remote", "get-url", "origin"], repo)), "Origin")
        command(["git", "ls-remote", "--exit-code", "origin", "refs/heads/main"], repo, timeout=30)

    def authorization():
        from release_verify_delivery import BASE, Client, gitea_authorization

        value = Client(BASE, authorization=gitea_authorization()).json("/api/v1/repos/hugo/cageledger", timeout=30)
        require(value.get("permissions", {}).get("push") is True, "Repository push permission")

    with noninteractive_credentials():
        check("macOS 主机", lambda: require(sys.platform == "darwin", "Platform"), "受管发布在 Mac mini 上执行。")
        check(
            "内存压力",
            lambda: require(
                execute(["sysctl", "-n", "kern.memorystatus_vm_pressure_level"]).strip() == "1", "Pressure"
            ),
            "当前内存压力不正常；先结束自己启动的重任务，待恢复后再验证，不终止其他人的进程。",
        )
        check("Node 22", node, "安装项目要求的 Node 22.12+，或检查 release_local.sh 的本地 Node 路径。")
        check(
            "Python 3.13 / .venv",
            lambda: command(["node", "scripts/check_python_runtime.mjs"], repo, timeout=20),
            "按 CONTRIBUTING.md 配置 .venv；不要使用系统 Python。",
        )
        check(
            "Git 身份",
            lambda: require(config(repo, "user.name") and config(repo, "user.email"), "Identity"),
            "为发布检出配置 user.name 与 user.email；不要求签名密钥。",
        )
        check(
            "隔离检出",
            lambda: require(not (repo / ".env").exists(), "Environment"),
            "正式发布使用无 .env 的隔离检出；不要删除或修改开发/生产配置。",
        )
        check(
            "锁定版本的浏览器",
            lambda: browser_installations(repo),
            "先 npm ci，再用本项目的 npx playwright install chromium firefox webkit 安装匹配版本。",
        )
        check("PDF 专用 Chromium", lambda: pdf_browser(repo), "安装锁定版本的 Chromium；受管测试不使用系统 Chrome。")
        check(
            "Docker / Buildx",
            lambda: (
                command(["docker", "info"], repo, timeout=15),
                command(["docker", "buildx", "version"], repo, timeout=15),
            ),
            "启动 Docker 并确认当前 context 与 Buildx 可用。",
        )
        check(
            "LibreOffice 转换器",
            converter,
            "检查开发目录的 DMG 缓存及 SHA256 元数据，或指定 CAGELEDGER_LIBREOFFICE_BIN；需正式签名和公证有效的应用。",
        )
        if sign:
            check(
                "提交与标签签名实测",
                lambda: verify_signing(repo),
                "检查 user.signingkey、allowedSignersFile/principal 与登录钥匙串；临时仓库签名或验证未通过。",
            )
        else:
            print("[SKIP] Git 签名：默认关闭；显式 --sign 才检查密钥、签名并验证。", flush=True)
        if online:
            check("Git 远端访问", transport, "检查正式 origin、网络与 Git 传输凭据；签名密钥与推送认证是两件事。")
            check(
                "Gitea API 权限",
                authorization,
                "检查 Gitea credential helper / CAGELEDGER_GITEA_TOKEN 的仓库 push 权限。",
            )
            from release_runtime import manifest_identity

            check(
                "Registry 读取认证",
                lambda: manifest_identity(repo, "ddns.cellnucle.us:3333/hugo/cageledger:latest"),
                "检查 Docker 官方仓库凭据与网络；只读预检不保证未来上传一定成功。",
            )
        else:
            print("[SKIP] 远端访问：加 --online 检查 Git/Gitea；此命令不推送或上传。", flush=True)
    print(f"[doctor] 完成，{len(failures)} 项未就绪。正式发布仍执行完整门禁、版本冲突和制品回读校验。", flush=True)
    return not failures
