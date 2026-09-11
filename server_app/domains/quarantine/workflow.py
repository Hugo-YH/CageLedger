"""Received intake pool and explicit, audited completion of the covered cohort."""

import copy

from . import repository as repo
from . import service


def intake_links(conn):
    links = {}
    for batch in repo.all_items(conn, "batches"):
        for source in batch["sources"]:
            if source.get("intakeId"):
                links.setdefault(source["intakeId"], []).append(
                    {"id": batch["id"], "name": batch["name"], "completedAt": batch.get("completedAt", "")}
                )
    return links


def decorate_intakes(conn, items):
    links = intake_links(conn)
    for item in items:
        related = links.get(item["id"], [])
        item["quarantineBatches"] = related
        item["quarantineStatus"] = (
            "检疫中"
            if any(not b["completedAt"] for b in related)
            else "已检疫"
            if related
            else "待检疫"
            if item.get("status") == "received"
            else "待接收"
        )
    return items


def completion_reasons(conn, batch, tests):
    superseded = {t.get("correctionOf") for t in tests}
    current = [t for t in tests if t["id"] not in superseded]
    species = {s["species"].lower() for s in batch["sources"]}
    required = {"parasite", "pcr"}
    if species & {"大鼠", "rat"}:
        required.add("elisa_rat")
    if species - {"大鼠", "rat"}:
        required.add("elisa_mouse")
    issued = {t["method"] for t in current if t["state"] == "issued" and not t.get("retestOf")}
    reasons = []
    if required - issued:
        reasons.append("三类检测尚未全部出具报告（大小鼠需各自完成 ELISA）")
    if any(t["state"] != "issued" for t in current):
        reasons.append("仍有检测或更正、复检草稿未完成")
    if not batch["conclusion"]:
        reasons.append("请先填写整批检疫最终结论")
    sources = {s["id"]: s for s in batch["sources"]}
    for test in current:
        for project in test["projects"]:
            for sid in project["sampleIds"]:
                result = project["results"].get(sid, "")
                if result == "negative":
                    continue
                sample = next(s for s in test["samples"] if s["id"] == sid)
                suppliers = {sources[source_id]["supplier"] for source_id in sample["sourceIds"]}
                resolved = (
                    result in {"positive", "suspect"}
                    and batch["handling"]
                    and all(
                        any(
                            r.get("retestOf") == test["id"]
                            and r["state"] == "issued"
                            and any(
                                s["id"] == sid and {sources[i]["supplier"] for i in s["sourceIds"]} == {supplier}
                                for s in r["samples"]
                            )
                            and any(
                                p["id"] == project["id"]
                                and sid in p["sampleIds"]
                                and p["results"].get(sid) == "negative"
                                for p in r["projects"]
                            )
                            for r in current
                        )
                        for supplier in suppliers
                    )
                )
                if not resolved:
                    reasons.append("存在未检测、未填写或尚未完成阴性复检的异常项目")
    return list(dict.fromkeys(reasons))


def complete(conn, user, entity_id, body):
    service.authorize(user)
    conn.execute("BEGIN IMMEDIATE")
    batch = repo.get(conn, "batches", entity_id)
    if batch.get("completedAt"):
        return batch
    service.check_version(batch, body)
    tests = repo.all_items(conn, "tests", entity_id)
    if body.get("expectedTestVersions") != {t["id"]: t["updatedAt"] for t in tests}:
        raise service.StaleWriteError("检测记录已变化，请刷新后确认")
    reasons = completion_reasons(conn, batch, tests)
    if reasons:
        raise ValueError("；".join(reasons))
    before = copy.deepcopy(batch)
    reports = [r for t in tests for r in repo.all_items(conn, "reports", t["id"])]
    if any(not repo.all_items(conn, "reports", t["id"]) for t in tests):
        raise ValueError("检测报告文件记录不完整")
    batch.update(
        completedAt=service.now(),
        completedBy={"id": user["id"], "name": user["displayName"]},
        completionReportIds=[r["id"] for r in reports],
        updatedAt=service.now(),
    )
    repo.save(conn, "batches", batch)
    service.audit(conn, user, "batch_completed", before, batch)
    return batch


def reopen(conn, user, batch):
    if not batch.get("completedAt"):
        return
    before = copy.deepcopy(batch)
    batch.setdefault("completionHistory", []).append(
        {
            "completedAt": batch["completedAt"],
            "completedBy": batch["completedBy"],
            "reportIds": batch["completionReportIds"],
            "conclusion": batch["conclusion"],
        }
    )
    batch.update(completedAt="", completionReportIds=[], updatedAt=service.now())
    repo.save(conn, "batches", batch)
    service.audit(conn, user, "batch_reopened_for_correction", before, batch)
