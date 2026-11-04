"""Use the locked Node Playwright Chromium for isolated PDF rendering too."""

import json
import os
import subprocess
from contextlib import contextmanager
from pathlib import Path


def pdf_browser(repo):
    result = subprocess.run(
        ["node", "-e", "console.log(JSON.stringify({executable:require('playwright').chromium.executablePath()}))"],
        cwd=repo,
        env={key: value for key, value in os.environ.items() if not key.startswith("PLAYWRIGHT_")},
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if result.returncode:
        raise RuntimeError("无法解析锁定的 PDF Chromium；先安装项目依赖和 Playwright Chromium。")
    value = json.loads(result.stdout)
    path = Path(value["executable"])
    if not path.is_file() or not os.access(path, os.X_OK):
        raise RuntimeError("锁定的 PDF Chromium 不可执行；安装当前 Playwright 对应的 Chromium。")
    return str(path)


@contextmanager
def managed_pdf_browser(repo):
    key = "CAGELEDGER_RELEASE_PDF_CHROMIUM"
    previous = os.environ.get(key)
    os.environ[key] = pdf_browser(repo)
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = previous
