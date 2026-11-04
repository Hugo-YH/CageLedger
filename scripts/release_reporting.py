"""Small, read-only release progress summaries. Never echo child output/secrets."""

import json
import time
from datetime import UTC, datetime
from pathlib import Path


def progress(output, started):
    stat = output.stat()
    elapsed = max(0, int(time.monotonic() - started))
    quiet = max(0, int(time.time() - stat.st_mtime))
    print(
        f"[release] {output.parent.parent.name}: 运行 {elapsed}s，日志 {stat.st_size} 字节，"
        f"最近输出 {quiet}s 前；{output}",
        flush=True,
    )


def show_status(directory):
    path = Path(directory) / "state.json"
    value = json.loads(path.read_text())
    print(f"发布 {value['identity']['version']} · {value['identity']['repo']}")
    print(f"状态文件：{path}")
    print(f"Git 签名策略：{value.get('signing', '历史状态，提交阶段按 signed 处理')}")
    for name, stage in value.get("stages", {}).items():
        seconds = stage.get("elapsed_seconds")
        if seconds is None and stage.get("started"):
            seconds = (datetime.now(UTC) - datetime.fromisoformat(stage["started"])).total_seconds()
        status = stage["status"]
        # A journal saying running is not proof that its owner is still alive.
        label = "running（记录状态，需核对进程是否仍在运行）" if status == "running" else status
        print(f"{name}: {label} · {round(seconds or 0)}s")
        print(f"  日志：{path.parent / name / stage['attempt'] / 'command.log'}")
    print("续跑使用原检出、原版本和相同 --state-dir；只有输入及产物匹配的通过结果可复用。")
    print("unknown 表示发布副作用尚未确认，须先核对远端，不能当成失败后直接重试上传。")
    summary = path.parent / "release-summary.json"
    if summary.exists():
        final = json.loads(summary.read_text())
        print(f"收尾：{final.get('status', 'unknown')}；制品发布：{final.get('publication', 'unknown')}")
        print(f"汇总：{summary}")
