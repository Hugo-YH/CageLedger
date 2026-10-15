"""Conservative reference checks; findings require review, never inferred repairs."""

from collections import Counter, defaultdict

from server_app.domains.intake.rules import is_cage_card_qr_id

from . import repository

DETECTOR_VERSION = "historical-references-v1"


def finding(code, entity_type, entity_id, reference_id, summary, evidence, *, status="needs_review"):
    return {
        "id": "dq-" + repository.digest([code, entity_type, entity_id, reference_id]),
        "code": code,
        "entityType": entity_type,
        "entityId": entity_id,
        "referenceId": reference_id,
        "summary": summary,
        "reviewStatus": status,
        "evidence": evidence,
    }


def detect(conn):
    batches = repository.payload_rows(conn, "intake_batches")
    tasks = repository.payload_rows(conn, "placement_tasks")
    occupancies = repository.payload_rows(conn, "occupancies")
    slots = repository.slot_ids(conn)
    findings = []
    for identity, record in occupancies.items():
        item = record["value"]
        slot = item.get("slotId") or ""
        if item.get("status") in ("active", "reserved") and slot not in slots:
            findings.append(
                finding(
                    "occupancy_missing_slot",
                    "occupancies",
                    identity,
                    slot,
                    "活动占用引用的笼位不存在，待核对实际位置及状态",
                    {"occupancyPayloadText": record["payloadText"], "missingSlotId": slot},
                )
            )
    historical = {}
    for identity, record in tasks.items():
        item = record["value"]
        batch_id = item.get("sourceBatchId") or ""
        batch = batches.get(batch_id)
        receipt_id = item.get("sourceReceiptId") or ""
        if not batch:
            findings.append(
                finding(
                    "placement_missing_batch",
                    "placement_tasks",
                    identity,
                    batch_id,
                    "进驻任务引用的接收批次不存在，待核对来源",
                    {"taskPayloadText": record["payloadText"], "missingBatchId": batch_id},
                )
            )
        elif receipt_id and receipt_id not in {r.get("id") for r in batch["value"].get("receipts") or []}:
            key = batch_id, receipt_id
            if key not in historical:
                historical[key] = repository.historical_receipts(conn, *key)
            findings.append(
                finding(
                    "placement_missing_receipt",
                    "placement_tasks",
                    identity,
                    receipt_id,
                    "进驻任务引用的接收明细不在父批次当前正文中，待核对历史记录",
                    {
                        "taskPayloadText": record["payloadText"],
                        "batchId": batch_id,
                        "batchPayloadText": batch["payloadText"],
                        "missingReceiptId": receipt_id,
                        "historicalReceiptSnapshots": historical[key],
                    },
                )
            )
    aliases = defaultdict(list)
    for identity, record in batches.items():
        for card in record["value"].get("cards") or []:
            alias = card.get("qrId") or ""
            if alias and not is_cage_card_qr_id(alias):
                aliases[alias].append({"batchId": identity, "card": card})
    for alias, cards in sorted(aliases.items()):
        if len(cards) > 1:
            findings.append(
                finding(
                    "duplicate_legacy_qr_alias",
                    "legacy_qr_alias",
                    alias,
                    "",
                    "旧格式二维码别名对应多张笼卡，待结合纸卡核对；保留原码",
                    {"alias": alias, "cards": cards},
                )
            )
    for item in repository.orphan_obligations(conn):
        confirmed = item["confirmedAllocations"]
        findings.append(
            finding(
                "orphan_settlement_obligation",
                "reimbursement_settlement_obligations",
                item["id"],
                item["workflowId"],
                "历史应收引用的流程不存在，已按现行规则排除有效应收"
                if not confirmed
                else "历史应收引用的流程不存在且有关联的已确认核销，需核对",
                item,
                status="needs_review" if confirmed else "retained_history",
            )
        )
    findings.sort(key=lambda item: item["id"])
    return {
        "detectorVersion": DETECTOR_VERSION,
        "latestBusinessAt": repository.latest_business_at(conn),
        "scope": "历史笼位、进驻来源、旧码别名及孤立应收引用；不代替完整业务核查",
        "summary": {
            "needsReview": sum(item["reviewStatus"] == "needs_review" for item in findings),
            "retainedHistory": sum(item["reviewStatus"] == "retained_history" for item in findings),
            "byCode": dict(sorted(Counter(item["code"] for item in findings).items())),
        },
        "findings": findings,
    }
