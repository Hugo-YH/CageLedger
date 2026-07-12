"""Chromium-backed PDF rendering for printable server documents."""

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from queue import Queue
from threading import Event, Lock, Thread

RENDER_TIMEOUT_SECONDS = 120


class PlaywrightUnavailable(RuntimeError):
    """Raised when the optional persistent renderer is unavailable."""


@dataclass
class RenderJob:
    markup: str | None
    completed: Event
    result: bytes | None = None
    error: Exception | None = None


class PersistentChromiumRenderer:
    """Own one Chromium process and serialize PDF work through a worker thread."""

    def __init__(self):
        self._jobs: Queue[RenderJob] = Queue()
        self._lock = Lock()
        self._thread: Thread | None = None

    def render(self, markup):
        job = RenderJob(markup=markup, completed=Event())
        self._start()
        self._jobs.put(job)
        if not job.completed.wait(RENDER_TIMEOUT_SECONDS):
            raise RuntimeError("PDF 渲染超时，请稍后重试")
        if job.error:
            raise job.error
        if job.result is None:
            raise RuntimeError("PDF 渲染失败，未生成文件")
        return job.result

    def prewarm(self):
        self._start()
        self._jobs.put(RenderJob(markup=None, completed=Event()))

    def _start(self):
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._thread = Thread(target=self._run, name="cageledger-pdf", daemon=True)
            self._thread.start()

    def _run(self):
        browser = None
        page = None
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self._fail_pending(PlaywrightUnavailable("缺少 Playwright PDF 渲染组件"))
            return

        with sync_playwright() as playwright:
            while True:
                job = self._jobs.get()
                try:
                    if browser is None:
                        browser = playwright.chromium.launch(
                            executable_path=required_chromium_binary(),
                            headless=True,
                            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run"],
                        )
                        page = browser.new_page()
                        page.emulate_media(media="print")
                    if job.markup is not None:
                        page.set_content(job.markup, wait_until="load")
                        job.result = page.pdf(print_background=True, prefer_css_page_size=True)
                except Exception as exc:  # Browser process recovery belongs to the next queued job.
                    job.error = RuntimeError(f"PDF 渲染失败：{str(exc).splitlines()[0]}")
                    if browser:
                        browser.close()
                    browser = None
                    page = None
                finally:
                    job.completed.set()

    def _fail_pending(self, error):
        while not self._jobs.empty():
            job = self._jobs.get()
            job.error = error
            job.completed.set()


_PERSISTENT_RENDERER = PersistentChromiumRenderer()


def html_to_pdf(markup):
    """Render HTML through a reused Chromium browser process."""
    try:
        return _PERSISTENT_RENDERER.render(markup)
    except PlaywrightUnavailable:
        return command_line_render(markup)


def prewarm_pdf_renderer():
    """Start Chromium during service boot so the first export avoids cold start."""
    _PERSISTENT_RENDERER.prewarm()


def required_chromium_binary():
    chromium = chromium_binary()
    if not chromium:
        raise RuntimeError("PDF 渲染组件未安装，请在服务器安装 Chromium 后重新部署")
    return chromium


def command_line_render(markup):
    """Keep source-only installations usable before Playwright is installed."""
    chromium = required_chromium_binary()
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
                timeout=RENDER_TIMEOUT_SECONDS,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError("PDF 渲染服务启动失败，请检查 Chromium 运行环境") from exc
        if not completed.returncode and output.exists():
            return output.read_bytes()
        playwright_render(source, output)
        if output.exists():
            return output.read_bytes()
        detail = (completed.stderr or completed.stdout).strip()
        raise RuntimeError(f"PDF 渲染失败：{detail or 'Chromium 未生成文件'}")


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
    """Use Playwright's managed browser for macOS source-only installations."""
    script = Path(__file__).with_name("playwright_renderer.mjs")
    if not script.exists() or not shutil.which("node"):
        return
    try:
        subprocess.run(
            ["node", str(script), str(source), str(output)],
            check=False,
            capture_output=True,
            text=True,
            timeout=RENDER_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return
