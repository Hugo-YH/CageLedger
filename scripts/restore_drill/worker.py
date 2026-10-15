"""Child process: real application checks against an explicitly private restore."""

import argparse
import json
import os
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.database_review.storage import write_json  # noqa: E402
from scripts.database_review.worker import check  # noqa: E402
from scripts.restore_drill.files import file_fact  # noqa: E402
from scripts.restore_drill.http_checks import downloads  # noqa: E402


def block_external_network(event, args):
    # No Gitea, AI, remote feedback refresh, or DNS access in an offline drill.
    if event == "socket.connect":
        address = args[1]
        if isinstance(address, tuple) and address[0] not in ("127.0.0.1", "::1"):
            raise PermissionError("离线恢复演练禁止外部网络连接")
    elif event == "socket.getaddrinfo" and args[0] not in ("127.0.0.1", "::1", "localhost", None):
        raise PermissionError("离线恢复演练禁止外部域名查询")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("request", type=Path)
    args = parser.parse_args()
    request = json.loads(args.request.read_text())
    os.umask(0o077)
    sys.addaudithook(block_external_network)
    try:
        checks = check(request)
        result = {"completed": True, "checks": checks}
        if request["case"] == "restored":
            root = Path(request["runtime"]) / "files"
            from server_app.config import (
                ANIMAL_INSPECTION_ATTACHMENTS_PATH,
                ANIMAL_INSPECTION_IMAGES_PATH,
                FEEDBACK_FILES_PATH,
                QUARANTINE_FILES_PATH,
                REIMBURSEMENT_ATTACHMENTS_PATH,
            )

            expected_paths = {
                QUARANTINE_FILES_PATH: root / "quarantine",
                FEEDBACK_FILES_PATH: root / "feedback",
                ANIMAL_INSPECTION_ATTACHMENTS_PATH: root / "animal-inspections/attachments",
                ANIMAL_INSPECTION_IMAGES_PATH: root / "animal-inspections/reference-images",
                REIMBURSEMENT_ATTACHMENTS_PATH: root / "reimbursements/attachments",
            }
            if any(actual.resolve() != expected.resolve() for actual, expected in expected_paths.items()):
                raise ValueError("恢复附件路径隔离失效")
            with closing(sqlite3.connect(request["database"])) as conn:
                conn.row_factory = sqlite3.Row
                result["attachments"] = downloads(
                    conn, request["references"], request["filesManifest"], request["fixturePrefix"]
                )
                conn.commit()
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            for name, expected in request["filesManifest"]["files"].items():
                if file_fact(root / name) != expected:
                    raise ValueError("应用读取后原附件字节发生变化")
    except Exception as exc:  # noqa: BLE001 - failure evidence remains private.
        result = {"completed": False, "errorType": type(exc).__name__, "error": str(exc)}
    write_json(request["result"], result)
    return 0 if result["completed"] else 1


if __name__ == "__main__":
    sys.exit(main())
