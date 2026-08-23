"""Chromium-backed PDF rendering for printable server documents."""

import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from itertools import count
from pathlib import Path
from queue import PriorityQueue
from threading import Event, Lock, Thread

RENDER_TIMEOUT_SECONDS = 120
PDF_RENDER_PRIORITY_USER = 0
PDF_RENDER_PRIORITY_WARM = 10
PDF_RENDER_SAMPLE_LIMIT = 256


class PlaywrightUnavailable(RuntimeError):
    """Raised when the optional persistent renderer is unavailable."""


@dataclass
class RenderJob:
    markup: str | None
    completed: Event
    result: bytes | None = None
    error: Exception | None = None
    cancelled: bool = False


@dataclass(order=True)
class _QueuedRender:
    priority: int
    sequence: int
    job: RenderJob = field(compare=False)


class PersistentChromiumRenderer:
    """Own one Chromium process and serialize PDF work through a worker thread."""

    def __init__(self):
        self._jobs: PriorityQueue[_QueuedRender] = PriorityQueue()
        self._lock = Lock()
        self._thread: Thread | None = None
        self._sequence = count()
        self._active = False
        self._completed = 0
        self._failures = 0
        self._timeouts = 0
        self._latency_samples: list[float] = []

    def render(self, markup, *, priority=PDF_RENDER_PRIORITY_USER):
        job = RenderJob(markup=markup, completed=Event())
        self._start()
        self._jobs.put(_QueuedRender(priority, next(self._sequence), job))
        if not job.completed.wait(RENDER_TIMEOUT_SECONDS):
            job.cancelled = True
            with self._lock:
                self._timeouts += 1
            raise RuntimeError("PDF 渲染超时，请稍后重试")
        if job.error:
            raise job.error
        if job.result is None:
            raise RuntimeError("PDF 渲染失败，未生成文件")
        return job.result

    def prewarm(self):
        self._start()
        self._jobs.put(_QueuedRender(-1, next(self._sequence), RenderJob(markup=None, completed=Event())))

    def snapshot(self):
        with self._lock:
            samples = list(self._latency_samples)
            active = self._active
            completed = self._completed
            failures = self._failures
            timeouts = self._timeouts
        return {
            "queueDepth": self._jobs.qsize(),
            "active": active,
            "completed": completed,
            "failures": failures,
            "timeouts": timeouts,
            **_latency_summary(samples),
        }

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
                queued = self._jobs.get()
                job = queued.job
                started_at = time.perf_counter()
                try:
                    if job.cancelled:
                        continue
                    with self._lock:
                        self._active = True
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
                        page.evaluate("document.fonts ? document.fonts.ready : Promise.resolve()")
                        job.result = page.pdf(print_background=True, prefer_css_page_size=True)
                        self._record_render(time.perf_counter() - started_at)
                except Exception as exc:  # Browser process recovery belongs to the next queued job.
                    job.error = RuntimeError(f"PDF 渲染失败：{str(exc).splitlines()[0]}")
                    self._record_render(time.perf_counter() - started_at, failed=True)
                    if browser:
                        browser.close()
                    browser = None
                    page = None
                finally:
                    with self._lock:
                        self._active = False
                    job.completed.set()
                    self._jobs.task_done()

    def _fail_pending(self, error):
        while not self._jobs.empty():
            job = self._jobs.get().job
            job.error = error
            job.completed.set()
            self._jobs.task_done()

    def _record_render(self, elapsed_seconds, *, failed=False):
        with self._lock:
            if failed:
                self._failures += 1
            else:
                self._completed += 1
            self._latency_samples.append(max(float(elapsed_seconds) * 1000, 0))
            if len(self._latency_samples) > PDF_RENDER_SAMPLE_LIMIT:
                del self._latency_samples[:-PDF_RENDER_SAMPLE_LIMIT]


_PERSISTENT_RENDERER = PersistentChromiumRenderer()


def html_to_pdf(markup, *, priority=PDF_RENDER_PRIORITY_USER):
    """Render HTML through a reused Chromium browser process."""
    try:
        return _PERSISTENT_RENDERER.render(markup, priority=priority)
    except PlaywrightUnavailable:
        return command_line_render(markup)


def prewarm_pdf_renderer():
    """Start Chromium during service boot so the first export avoids cold start."""
    _PERSISTENT_RENDERER.prewarm()


def pdf_renderer_snapshot():
    return _PERSISTENT_RENDERER.snapshot()


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


def _latency_summary(samples):
    if not samples:
        return {"sampleCount": 0, "averageMs": None, "p50Ms": None, "p95Ms": None, "maxMs": None}
    ordered = sorted(samples)
    size = len(ordered)
    return {
        "sampleCount": size,
        "averageMs": round(sum(ordered) / size, 1),
        "p50Ms": round(ordered[max((size + 1) // 2 - 1, 0)], 1),
        "p95Ms": round(ordered[max((size * 95 + 99) // 100 - 1, 0)], 1),
        "maxMs": round(ordered[-1], 1),
    }
