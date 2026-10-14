"""Service settlements use the existing versioned workflow state machine."""

import json
from collections import defaultdict

from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.administration import audit_event, write_audit_events
from server_app.domains.billing.frozen import frozen_statement
from server_app.domains.workflow.application import save_billing_statement_workflow, update_workflow_status
from server_app.domains.workflow.constants import WORKFLOW_STATUS_SENT
from server_app.domains.workflow.payloads import billing_workflow_business_key
from server_app.domains.workflow.permissions import with_withdrawal_capabilities
from server_app.repositories.billing_workflows import get_billing_workflow_by_key
from server_app.shared import clean_text, new_id, now_iso
from server_app.shared.concurrency import StaleWriteError

from . import repository as repo
from .rules import money_sum, validate_month
from .service import authorize


def current_workflow(conn, month, pi):
    return get_billing_workflow_by_key(conn, billing_workflow_business_key("pi", f"pi::{pi}", month, repo.SOURCE_TYPE))


def preview(conn, actor, payload):
    authorize(actor)
    month, pi = validate_month(payload.get("month")), clean_text(payload.get("pi"))
    if not pi:
        raise ValueError("请选择项目负责人")
    frozen = frozen_statement(conn, month, pi, repo.SOURCE_TYPE)
    if frozen:
        statement, lines = frozen
        return {"statement": statement, "lines": lines, "sourceVersions": statement.get("sourceVersions", {})}
    sheets = repo.list_sheets(conn, {"month": month, "pi": pi}, all_rows=True)["items"]
    if not sheets:
        raise LookupError("该负责人本月没有技术服务明细")
    entries = [
        {
            **row,
            **{
                key: sheet[key]
                for key in ("iacuc", "facility", "serviceId", "serviceName", "unit", "unitPrice", "funding", "project")
            },
            "sourceId": sheet["id"],
        }
        for sheet in sheets
        for row in sheet["rows"]
    ]
    entries.sort(key=lambda r: (r["date"], r["iacuc"], r["facility"], r["serviceId"]))
    statement = {
        "id": new_id("ts-preview"),
        "month": month,
        "pi": pi,
        "iacucs": sorted({s["iacuc"] for s in sheets}),
        "iacuc": "、".join(sorted({s["iacuc"] for s in sheets})),
        "sourceType": repo.SOURCE_TYPE,
        "sourceIds": [s["id"] for s in sheets],
        "sourceVersions": {s["id"]: s["updatedAt"] for s in sheets},
        "technicalServiceSheets": sheets,
        "technicalServiceRows": entries,
        "project": "、".join(dict.fromkeys(s["project"] for s in sheets)),
        "funding": "、".join(dict.fromkeys(s["funding"] for s in sheets)),
        "owner": "、".join(dict.fromkeys(s["owner"] for s in sheets if s["owner"])),
        "manager": actor["displayName"],
        "totalAmount": money_sum(entries),
        "serviceDayCount": len({r["date"] for r in entries if r["quantity"] > 0}),
        "totalCageDays": 0,
        "totalAnimalDays": 0,
        "totalFreeCageDays": 0,
        "totalBillableCageDays": 0,
        "generatedAt": now_iso(),
    }
    daily = defaultdict(list)
    for entry in entries:
        daily[entry["date"]].append(entry)
    lines, cumulative = [], 0
    for day, day_entries in sorted(daily.items()):
        amount = money_sum(day_entries)
        cumulative = round(cumulative + amount, 2)
        lines.append(
            {
                "date": day,
                "amount": amount,
                "cumulative": cumulative,
                "cageCount": 0,
                "animalCount": 0,
                "freeCages": 0,
                "billableCages": 0,
                "technicalServiceRows": day_entries,
            }
        )
    return {"statement": statement, "lines": lines, "sourceVersions": statement["sourceVersions"]}


def initiate(conn, actor, payload):
    authorize(actor)
    conn.execute("BEGIN IMMEDIATE")
    result = preview(conn, actor, payload)
    statement = result["statement"]
    if statement.get("workflowId"):
        return result
    if payload.get("sourceVersions") != result["sourceVersions"]:
        raise StaleWriteError("技术服务明细已变化，请重新预览后发起结算")
    workflow, version, statement, lines, events = save_billing_statement_workflow(
        conn, statement, result["lines"], actor, f"生成 {statement['pi']} {statement['month']} 技术服务结算单"
    )
    workflow, version, event = update_workflow_status(
        conn, workflow["id"], WORKFLOW_STATUS_SENT, actor, "发起技术服务结算"
    )
    events.append(event)
    write_audit_events(
        conn,
        [
            audit_event(
                actor,
                "technical_service.settlement_started",
                "billing_workflow",
                workflow["id"],
                "发起技术服务结算",
                [],
                now_iso(),
                None,
                {"workflow": workflow, "version": version, "events": events},
            )
        ],
    )
    invalidate_data_cache_prefixes("billing_workflows::", "billing_statements::", "reimbursement_records::")
    return {
        "statement": version["statement"],
        "lines": lines,
        "workflow": workflow,
        "sourceVersions": result["sourceVersions"],
    }


def candidates(conn, actor, filters):
    authorize(actor)
    scopes, page = repo.candidate_scopes(conn, filters)
    items = []
    for scope in scopes:
        month, pi = scope["month"], scope["pi"]
        sheets = repo.list_sheets(conn, {"month": month, "pi": pi}, all_rows=True)["items"]
        workflow = current_workflow(conn, month, pi)
        frozen = frozen_statement(conn, month, pi, repo.SOURCE_TYPE)
        items.append(
            {
                "id": f"{month}|{pi}",
                "month": month,
                "pi": pi,
                "iacucs": sorted({s["iacuc"] for s in sheets}),
                "totalAmount": frozen[0]["totalAmount"]
                if frozen
                else money_sum([{"amount": s["totalAmount"]} for s in sheets]),
                "manager": "、".join(dict.fromkeys(s["manager"] for s in sheets)),
                "workflowId": workflow["id"] if workflow else "",
                "hasWorkflow": bool(workflow),
                "workflowStatus": workflow.get("workflowStatus", "") if workflow else "",
            }
        )
    items = with_withdrawal_capabilities(conn, actor, items, id_key="workflowId")
    return {"items": items, "page": page}


def export_sheets(conn, month):
    """Each source belongs either to one issued snapshot or to current drafts."""
    drafts = repo.list_sheets(conn, {"month": month}, all_rows=True)["items"]
    by_pi = defaultdict(list)
    for sheet in drafts:
        by_pi[sheet["pi"]].append(sheet)
    for row in conn.execute(
        "SELECT payload FROM billing_workflows WHERE month=? AND source_type=?", (month, repo.SOURCE_TYPE)
    ):
        pi = json.loads(row[0]).get("pi", "")
        by_pi.setdefault(pi, [])
    result = []
    for pi, sheets in by_pi.items():
        frozen = frozen_statement(conn, month, pi, repo.SOURCE_TYPE)
        if frozen:
            snapshot = frozen[0].get("technicalServiceSheets", [])
            used = {s["id"] for s in snapshot}
            result.extend(snapshot)
            result.extend(s for s in sheets if s["id"] not in used)
        else:
            result.extend(sheets)
    return result
