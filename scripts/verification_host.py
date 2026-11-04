"""One resource-heavy CageLedger verification per logged-in host user."""

import fcntl
import os
from contextlib import contextmanager
from pathlib import Path

from release_runtime import command, require


@contextmanager
def host_task_lock(directory=None):
    # Shared by independent clones as well as worktrees. Never unlink a lock file:
    # a waiter could otherwise hold the old inode while another process enters.
    directory = directory or Path.home() / "Library/Caches/CageLedger"
    directory.mkdir(parents=True, exist_ok=True)
    fd = os.open(directory / "verification.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "r+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError(
                "宿主机已有 CageLedger 验证/发布任务；请等待结束，不叠加启动，也不终止未知进程。"
            ) from None
        yield


def check_browser_slots(slots, repo):
    if slots > 1:
        memory = int(command(["sysctl", "-n", "hw.memsize"], repo, timeout=10))
        require(memory >= 24 * 1024**3, "16GB 主机只允许一组浏览器；两组需至少 24GiB 且通过资源准入。")
