"""Download accessible local assets through the unmodified authenticated API."""

import hashlib
import io
import threading
from http.server import ThreadingHTTPServer
from urllib.request import ProxyHandler, Request, build_opener

from scripts.database_review.storage import original_records, source_scope


def downloads(conn, refs, manifest, fixture_prefix):
    from server_app.repositories.users import create_session
    from server_app.web.application import CageLedgerHandler

    token, _ = create_session(conn, fixture_prefix + "-admin", 1)
    conn.commit()
    before = source_scope(conn)

    class QuietHandler(CageLedgerHandler):
        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    opener = build_opener(ProxyHandler({}))
    result = {"downloads": [], "errors": [], "storageOnly": [], "missing": []}
    try:
        for item in refs["local"]:
            identity = {key: item[key] for key in ("kind", "id", "path")}
            fact = manifest["files"].get(item["path"])
            if fact is None:
                result["missing"].append(identity)
                continue
            if not item["endpoint"]:
                result["storageOnly"].append(identity)
                continue
            request = Request(
                f"http://127.0.0.1:{server.server_port}" + item["endpoint"],
                headers={"Cookie": "cageledger_session=" + token},
            )
            try:
                with opener.open(request, timeout=60) as response:
                    body, mime = response.read(), response.headers.get_content_type()
                sha = hashlib.sha256(body).hexdigest()
                if item["conversion"]:
                    from pypdf import PdfReader

                    if (
                        mime != "application/pdf"
                        or not body.startswith(b"%PDF-")
                        or not PdfReader(io.BytesIO(body)).pages
                    ):
                        raise ValueError("历史Word未能通过现有接口转换为PDF")
                elif {"bytes": len(body), "sha256": sha} != fact:
                    raise ValueError("HTTP下载与恢复清单字节不一致")
                result["downloads"].append(
                    {**identity, "bytes": len(body), "sha256": sha, "converted": item["conversion"]}
                )
            except Exception as exc:  # noqa: BLE001 - retain every failed asset rather than lose later evidence.
                result["errors"].append({**identity, "errorType": type(exc).__name__, "error": str(exc)})
    finally:
        server.shutdown()
        server.server_close()
        thread.join(5)
        if thread.is_alive():
            raise RuntimeError("恢复演练下载服务未停止")
    if original_records(conn, before) != {name: spec["rows"] for name, spec in before.items()}:
        raise ValueError("附件HTTP核验修改了数据库记录或审计")
    return result
