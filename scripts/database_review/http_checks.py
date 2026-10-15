"""Authenticated loopback HTTP checks against a worker-owned copy only."""

import hashlib
import json
import threading
import zlib
from http.server import ThreadingHTTPServer
from urllib.parse import quote
from urllib.request import ProxyHandler, Request, build_opener

from .storage import digest


def audit_payloads(conn):
    from server_app.repositories.audit_storage import payloads_for_rows

    rows = conn.execute("SELECT id,payload FROM audit_events ORDER BY rowid").fetchall()
    result = {}
    for row, raw in zip(rows, payloads_for_rows(conn, rows), strict=True):
        event = json.loads(raw)
        if not isinstance(event, dict) or event.get("id") != row["id"]:
            raise ValueError(f"审计正文标识不匹配: {row['id']}")
        result[row["id"]] = event
    return result


def normalize_sync_event(event):
    value = {key: item for key, item in event.items() if key not in ("id", "at")}
    if value.get("action") == "reimbursement_ledger.obligation_snapshot_synced":
        value["after"] = {key: item for key, item in (value.get("after") or {}).items() if key != "updatedAt"}
    return value


def plaintext_audit_facts(rows):
    """Keep source plaintext as an independent reference for the decoder."""
    result = {}
    for identity, raw in rows:
        value = json.loads(raw)
        if isinstance(value, dict) and "_auditStorage" not in value and "before" in value and "after" in value:
            result[identity] = digest(value)
    return result


def source_audit_facts(conn):
    """Independently decode the source format before invoking app migrations/readers."""
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    blocks = {}
    if "audit_event_payload_blocks" in tables:
        blocks = {
            row[0]: row[1:]
            for row in conn.execute(
                "SELECT event_id,codec,raw_bytes,raw_sha256,payload FROM audit_event_payload_blocks"
            )
        }
    result = {}
    for identity, stored in conn.execute("SELECT id,payload FROM audit_events"):
        event = json.loads(stored)
        if identity in blocks:
            codec, size, sha, blob = blocks[identity]
            if codec != "zlib-audit-json-v1" or not isinstance(size, int) or not 0 < size <= 128 * 1024 * 1024:
                raise ValueError("原审计压缩块格式无效")
            decoder = zlib.decompressobj()
            raw = decoder.decompress(blob, size + 1)
            if (
                len(raw) != size
                or not decoder.eof
                or decoder.unused_data
                or decoder.unconsumed_tail
                or hashlib.sha256(raw).hexdigest() != sha
            ):
                raise ValueError("原审计压缩块内容校验失败")
            envelope = json.loads(raw)
            if envelope["eventId"] != identity or not isinstance(envelope["payload"], str):
                raise ValueError("原审计压缩块标识无效")
            event = json.loads(envelope["payload"])
        elif "_auditStorage" in event:
            raise ValueError("原审计详情压缩块缺失")
        if not isinstance(event, dict) or event.get("id") != identity or "_auditStorage" in event:
            raise ValueError("原审计正文标识无效")
        result[identity] = digest(event)
    return result


def normalize_obligation(item, original_ids, synchronized):
    item = dict(item)
    if item["id"] not in original_ids:
        for key in ("id", "createdAt", "updatedAt"):
            item.pop(key, None)
    elif item["id"] in synchronized:
        item.pop("updatedAt", None)
    return item


def check_http(conn, original_ids, fixture_prefix):
    from server_app.db import connect_db
    from server_app.domains.intake.rules import cage_card_qr_id_from_batch_card, is_cage_card_qr_id
    from server_app.domains.workflow.constants import WORKFLOW_STATUS_FINANCE, WORKFLOW_STATUS_GENERATED
    from server_app.repositories.users import create_session
    from server_app.web.application import CageLedgerHandler

    cookies = {}
    for role in ("admin", "room_admin"):
        identity = fixture_prefix + "-" + role
        conn.execute(
            """INSERT INTO users(id,username,display_name,password_hash,role,room_ids,billing_lock_allowed,
               active,created_at,updated_at) VALUES (?,?,?,'unused',?,'[]',1,1,'2000-01-01','2000-01-01')""",
            (identity, identity, "数据库副本核查", role),
        )
        token, _ = create_session(conn, identity, 1)
        cookies[role] = "cageledger_session=" + token
    conn.commit()
    existing_audits = set(audit_payloads(conn))
    existing_obligations = {row[0] for row in conn.execute("SELECT id FROM reimbursement_settlement_obligations")}
    versions = {row[0]: row[1] for row in conn.execute("SELECT id,current_version_id FROM billing_workflows")}
    excluded = {
        row[0]
        for row in conn.execute(
            "SELECT id FROM billing_workflows WHERE workflow_status IN (?,?)",
            (WORKFLOW_STATUS_FINANCE, WORKFLOW_STATUS_GENERATED),
        )
    }

    class QuietHandler(CageLedgerHandler):
        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    opener = build_opener(ProxyHandler({}))
    result = {"lists": {}, "details": {}, "lines": {}, "public": {}, "roles": {}}
    count = 0

    def request(path, role="admin"):
        nonlocal count
        request = Request(
            f"http://127.0.0.1:{server.server_port}" + path,
            headers={"Cookie": cookies[role], "Accept": "application/json"},
        )
        with opener.open(request, timeout=30) as response:
            value = json.loads(response.read())
        count += 1
        return value

    def all_items(endpoint):
        items, offset = [], 0
        while True:
            value = request(endpoint + f"?limit=100&offset={offset}")
            items.extend(value["items"])
            offset += value["page"]["limit"]
            if offset >= value["page"]["total"]:
                return items

    try:
        for endpoint, table in (
            ("intake-batches", "intake_batches"),
            ("quantity-sheets", "quantity_sheets"),
            ("billing-workflows", "billing_workflows"),
            ("audit-events", "audit_events"),
        ):
            items = {item["id"]: item for item in all_items("/api/" + endpoint)}
            expected = set(original_ids.get(table, [])) - (excluded if table == "billing_workflows" else set())
            if not expected <= items.keys():
                raise ValueError(f"HTTP列表遗漏原有记录: {table}")
            result["lists"][table] = {identity: digest(items[identity]) for identity in sorted(expected)}
            if table == "audit_events":
                continue
            result["details"][table] = {
                identity: digest(request("/api/" + endpoint + "/" + quote(identity, safe="")))
                for identity in original_ids.get(table, [])
            }
        for identity in original_ids.get("billing_workflows", []):
            result["lines"][identity] = digest(
                request(
                    "/api/billing-workflows/"
                    + quote(identity, safe="")
                    + "/lines?versionId="
                    + quote(versions[identity], safe="")
                )
            )
        for row in conn.execute("SELECT payload FROM intake_batches"):
            batch = json.loads(row[0])
            for card in batch.get("cards") or []:
                if is_cage_card_qr_id(card.get("qrId")):
                    qr = cage_card_qr_id_from_batch_card(batch, card["index"])
                    result["public"][qr] = digest(request("/api/public/cage-card/" + quote(qr, safe="")))
        for role in ("admin", "room_admin"):
            result["roles"][role] = [
                digest(request("/api/quantity-sheets/" + quote(identity, safe=""), role))
                for identity in original_ids.get("quantity_sheets", [])[-3:]
            ]
        obligations = all_items("/api/reimbursement-ledger/obligations")
        # GET synchronization is intentionally exercised; only the private copy
        # can change. Compare the resulting amounts and complete new audit facts.
        with connect_db() as refreshed:
            new_audits = [
                event for identity, event in audit_payloads(refreshed).items() if identity not in existing_audits
            ]
        synchronized = {
            event["entityId"]
            for event in new_audits
            if event["action"] == "reimbursement_ledger.obligation_snapshot_synced"
        }
        result["syncAudits"] = sorted((normalize_sync_event(event) for event in new_audits), key=digest)
        result["obligations"] = {}
        for item in obligations:
            key = digest((item["workflowId"], item["statementVersionId"], item["obligationKind"]))
            if key in result["obligations"]:
                raise ValueError("有效应收的来源业务键重复")
            result["obligations"][key] = normalize_obligation(item, existing_obligations, synchronized)
        result["requests"] = count
        result["synchronizedIds"] = sorted(synchronized)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(5)
        if thread.is_alive():
            raise RuntimeError("副本HTTP测试服务未停止")
    return result
