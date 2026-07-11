"""Chromium-backed PDF rendering for printable server documents."""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def html_to_pdf(markup):
    """Render HTML with Chromium so downloads share browser print layout."""
    chromium = chromium_binary()
    if not chromium:
        raise RuntimeError("PDF 渲染组件未安装，请在服务器安装 Chromium 后重新部署")

    with tempfile.TemporaryDirectory(prefix="cageledger-pdf-") as directory:
        source = Path(directory) / "document.html"
        output = Path(directory) / "document.pdf"
        source.write_text(markup, encoding="utf-8")
        try:
            completed = subprocess.run(
                [
                    chromium,
                    "--headless=new",
                    "--disable-gpu",
                    "--no-sandbox",
                    "--no-pdf-header-footer",
                    f"--print-to-pdf={output}",
                    source.as_uri(),
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=60,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError("PDF 渲染服务启动失败，请检查 Chromium 运行环境") from exc
        if not completed.returncode and output.exists():
            return output.read_bytes()
        playwright_render(source, output)
        if not output.exists():
            detail = (completed.stderr or completed.stdout).strip()
            raise RuntimeError(f"PDF 渲染失败：{detail or 'Chromium 未生成文件'}")
        return output.read_bytes()


def chromium_binary():
    configured = os.environ.get("CAGELEDGER_CHROMIUM_BIN", "").strip()
    candidates = [configured] if configured else []
    candidates.extend(
        filter(
            None,
            [
                shutil.which("chromium"),
                shutil.which("chromium-browser"),
                shutil.which("google-chrome"),
                "/usr/bin/chromium",
                "/usr/bin/chromium-browser",
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
            ],
        )
    )
    candidates.extend(
        str(path)
        for path in Path.home().glob(
            "Library/Caches/ms-playwright/chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
        )
    )
    return next((candidate for candidate in candidates if Path(candidate).is_file()), None)


def playwright_render(source, output):
    """Use Playwright's managed browser for macOS development installations."""
    script = Path(__file__).with_name("playwright_renderer.mjs")
    if not script.exists() or not shutil.which("node"):
        return
    try:
        subprocess.run(
            ["node", str(script), str(source), str(output)],
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return
