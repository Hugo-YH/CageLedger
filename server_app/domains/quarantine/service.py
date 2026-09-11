"""Quarantine writes are serialized with version checks and audit snapshots."""

import copy
import re
from datetime import UTC, date, datetime
from uuid import uuid4

from server_app.domains.administration.audit import audit_event, write_audit_events
from server_app.domains.intake.strain_standard import abbreviate_supplier
from server_app.shared.concurrency import StaleWriteError

from . import repository as repo
from .catalog import PROJECTS, RESULTS


def now():
    return datetime.now(UTC).isoformat(timespec="microseconds")


def authorize(user):
    if not user or not user.get("id"):
        raise PermissionError("请先登录")


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value):
        raise ValueError("记录编号无效")
    return value


def check_version(before, body):
    if not body.get("expectedUpdatedAt") or body["expectedUpdatedAt"] != before["updatedAt"]:
        raise StaleWriteError("记录已更新或缺少版本，请刷新后重新编辑")


def audit(conn, user, action, before, after):
    write_audit_events(
        conn,
        [
            audit_event(
                user, f"quarantine.{action}", "quarantine", after["id"], f"检疫{action}", [], now(), before, after
            )
        ],
    )


def text(value):
    if not isinstance(value, str) or len(value) > 10000:
        raise ValueError("文字字段格式错误或过长")
    return value.strip()


def validate_date(value):
    if value:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("日期请使用YYYY-MM-DD格式")
        date.fromisoformat(value)
    return value


def source_snapshot(conn, source, existing):
    sid = identifier(source["id"])
    previous = next((item for item in existing if item["id"] == sid), None)
    if previous:
        return previous
    intake_id = source.get("intakeId")
    raw = repo.intake(conn, identifier(intake_id)) if intake_id else source
    if intake_id and raw.get("status") != "received":
        raise ValueError("只能从已接收动物中选择检疫来源")
    result = {
        key: text(str(raw.get(key, "") or ""))
        for key in (
            "supplier",
            "pi",
            "owner",
            "iacuc",
            "species",
            "intakeDate",
            "batchNo",
            "notes",
            "strainRaw",
            "strainStandard",
            "sex",
            "quantity",
        )
    }
    result.update(id=sid, intakeId=intake_id or "", manual=not bool(intake_id))
    result["supplier"] = abbreviate_supplier(result["supplier"])
    if not result["supplier"] or not result["species"]:
        raise ValueError("来源需填写供应商和动物种类")
    validate_date(result["intakeDate"])
    return result


def save_batch(conn, user, body, entity_id=None):
    authorize(user)
    conn.execute("BEGIN IMMEDIATE")
    before = repo.get(conn, "batches", entity_id) if entity_id else None
    if before:
        check_version(before, body)
        if before.get("completedAt"):
            raise ValueError("已完成检疫，请先从已出具报告创建更正记录")
    raw = body["item"]
    sources = [source_snapshot(conn, s, before["sources"] if before else []) for s in raw.get("sources", [])]
    ids = [s["id"] for s in sources]
    intake_ids = [s["intakeId"] for s in sources if s["intakeId"]]
    if len(ids) != len(set(ids)) or len(intake_ids) != len(set(intake_ids)):
        raise ValueError("来源或到货批次不能重复")
    from .workflow import intake_links

    links = intake_links(conn)
    previous_intakes = {s.get("intakeId") for s in before["sources"]} if before else set()
    if any(i not in previous_intakes and links.get(i) for i in intake_ids):
        raise ValueError("所选动物已加入检疫批次，请刷新待检疫池后重选")
    if (
        before
        and any(t["state"] == "issued" for t in repo.all_items(conn, "tests", entity_id))
        and sources != before["sources"]
    ):
        raise ValueError("已有正式报告，不能变更检疫覆盖范围")
    if before:
        used = {
            sid
            for test in repo.all_items(conn, "tests", entity_id)
            for sample in test["samples"]
            for sid in sample["sourceIds"]
        }
        if used - set(ids):
            raise ValueError("已参与检测的来源不能移除")
    item = {
        "id": entity_id or identifier(raw["id"]),
        "name": text(raw["name"]),
        "sources": sources,
        "conclusion": text(raw.get("conclusion", "")),
        "handling": text(raw.get("handling", "")),
        "updatedAt": now(),
    }
    if before and before.get("completionHistory"):
        item["completionHistory"] = before["completionHistory"]
    if not item["name"] or not sources:
        raise ValueError("请填写检疫批次名称并添加覆盖来源")
    repo.save(conn, "batches", item, create=not before)
    audit(conn, user, "batch_saved", before, item)
    return item


def validate_test(item, batch):
    if len(item["samples"]) > 200 or len(item["projects"]) > 100:
        raise ValueError("单份记录最多200个样本、100个项目")
    if item["method"] not in PROJECTS:
        raise ValueError("检测方法无效")
    for key in ("samplingDate", "testDate"):
        validate_date(item[key])
    source_ids = {s["id"] for s in batch["sources"]}
    sample_ids = set()
    for sample in item["samples"]:
        sid = identifier(sample["id"])
        if sid in sample_ids or not text(sample["number"]):
            raise ValueError("样本编号缺失或重复")
        sample_ids.add(sid)
        if not sample["sourceIds"] or set(sample["sourceIds"]) - source_ids:
            raise ValueError("样本来源必须属于检疫覆盖范围")
        for key in ("poolCount", "portionCount"):
            if type(sample[key]) is not int or not 1 <= sample[key] <= 100000:
                raise ValueError("混样数与原始样本份数必须是正整数")
        if sample["portionCount"] < sample["poolCount"]:
            raise ValueError("原始样本份数不能小于混样数")
        text(sample["material"])
        if item["method"].startswith("elisa"):
            expected = "大鼠" if item["method"] == "elisa_rat" else "小鼠"
            allowed = {expected, "rat" if expected == "大鼠" else "mouse"}
            if any(s["species"].lower() not in allowed for s in batch["sources"] if s["id"] in sample["sourceIds"]):
                raise ValueError(f"本ELISA记录只能包含{expected}样本")
    if len({s["number"] for s in item["samples"]}) != len(item["samples"]):
        raise ValueError("样本编号不能重复")
    project_ids = set()
    for project in item["projects"]:
        pid = identifier(project["id"])
        if pid in project_ids or not text(project["name"]):
            raise ValueError("检测项目名称缺失或编号重复")
        project_ids.add(pid)
        applicable = set(project["sampleIds"])
        if applicable - sample_ids:
            raise ValueError("检测项目引用了不存在的样本")
        if item["method"] == "pcr" and "（大鼠）" in project["name"]:
            selected_sources = {
                sid for sample in item["samples"] if sample["id"] in applicable for sid in sample["sourceIds"]
            }
            if any(
                s["species"].lower() not in {"大鼠", "rat"} for s in batch["sources"] if s["id"] in selected_sources
            ):
                raise ValueError("大鼠专属PCR项目只能选择大鼠样本")
        if set(project["results"]) - applicable:
            raise ValueError("结果引用了不适用的样本")
        for result in project["results"].values():
            if result not in {*RESULTS, ""}:
                raise ValueError("判定无效")
        for result in (project.get("nc", ""), project.get("pc", "")):
            if result not in {*RESULTS, ""}:
                raise ValueError("对照判定无效")
        for key in ("kit", "lot"):
            text(project.get(key, ""))
    return item


def save_test(conn, user, body, entity_id=None):
    authorize(user)
    conn.execute("BEGIN IMMEDIATE")
    before = repo.get(conn, "tests", entity_id) if entity_id else None
    if before:
        check_version(before, body)
        if before["state"] != "draft":
            raise ValueError("已出具的检测需先创建更正草稿")
    raw = body["item"]
    batch = repo.get(conn, "batches", raw["batchId"])
    if batch.get("completedAt"):
        raise ValueError("该批已检疫，请先创建报告更正或复检记录")
    if before and (raw["batchId"] != before["batchId"] or raw["method"] != before["method"]):
        raise ValueError("已保存检测不能更换批次或方法")
    item = {key: text(raw.get(key, "")) for key in ("samplingDate", "testDate", "conclusion", "notes")}
    item.update(
        id=entity_id or identifier(raw["id"]),
        batchId=batch["id"],
        method=raw["method"],
        samples=copy.deepcopy(raw.get("samples", [])),
        projects=copy.deepcopy(raw.get("projects", [])),
        state="draft",
        updatedAt=now(),
        retestOf=before.get("retestOf", "") if before else "",
        correctionOf=before.get("correctionOf", "") if before else "",
    )
    if raw.get("reportFormVersion") == 2 or (before and before.get("reportFormVersion") == 2):
        item.update(
            reportFormVersion=2,
            reportMaterial=text(raw.get("reportMaterial", "")),
            reportSpecimenState=text(raw.get("reportSpecimenState", "")),
        )
        for sample in item["samples"]:
            sample["sourceIds"] = list(dict.fromkeys(sample["sourceIds"]))
            sample["poolCount"] = 1
            sample["portionCount"] = len(sample["sourceIds"])
    validate_test(item, batch)
    if before:
        for attachment in repo.all_items(conn, "attachments", entity_id):
            if attachment.get("sampleId") and attachment["sampleId"] not in {s["id"] for s in item["samples"]}:
                raise ValueError("已有附件的样本不能删除")
            if set(attachment.get("projectIds", [attachment["projectId"]] if attachment.get("projectId") else [])) - {
                p["id"] for p in item["projects"]
            }:
                raise ValueError("已有附件的项目不能删除")
    repo.save(conn, "tests", item, create=not before)
    audit(conn, user, "test_saved", before, item)
    return item


def abnormal_samples(test):
    return {sid for p in test["projects"] for sid, result in p["results"].items() if result in {"positive", "suspect"}}


def batch_detail(conn, entity_id):
    batch = repo.get(conn, "batches", entity_id)
    tests = repo.all_items(conn, "tests", entity_id)
    source_map = {s["id"]: s for s in batch["sources"]}
    abnormal = any(abnormal_samples(t) for t in tests)
    cross = any(
        len({source_map[sid]["supplier"] for sid in s["sourceIds"]}) > 1
        for t in tests
        for s in t["samples"]
        if s["id"] in abnormal_samples(t)
    )
    pending_split = any(
        not split_retest_completed(tests, t["id"], sample["id"], supplier, source_map)
        for t in tests
        for sample in t["samples"]
        if sample["id"] in abnormal_samples(t)
        if len(suppliers := {source_map[sid]["supplier"] for sid in sample["sourceIds"]}) > 1
        for supplier in suppliers
    )
    batch["status"] = (
        "已检疫"
        if batch.get("completedAt")
        else "已填写结论（保留异常记录）"
        if abnormal and batch["conclusion"]
        else "已填写结论"
        if batch["conclusion"]
        else "待分开复检"
        if pending_split
        else "复检完成，待确认结论"
        if cross
        else "存在异常，待处理"
        if abnormal
        else "检测中"
    )
    from .workflow import completion_reasons

    return {
        "completionReasons": completion_reasons(conn, batch, tests),
        "item": batch,
        "tests": tests,
        "attachments": [a for t in tests for a in repo.all_items(conn, "attachments", t["id"])],
        "reports": [r for t in tests for r in repo.all_items(conn, "reports", t["id"])],
    }


def clone_test(conn, user, entity_id, body, *, retest=False):
    authorize(user)
    conn.execute("BEGIN IMMEDIATE")
    before = repo.get(conn, "tests", entity_id)
    check_version(before, body)
    if not retest and before["state"] != "issued":
        raise ValueError("只有已出具记录可以更正")
    if not retest and any(t.get("correctionOf") == entity_id for t in repo.all_items(conn, "tests", before["batchId"])):
        raise ValueError("该版本已有更正记录，请继续编辑或更正最新版本")
    item = copy.deepcopy(before)
    if retest:
        batch = repo.get(conn, "batches", before["batchId"])
        supplier = abbreviate_supplier(text(body.get("supplier", "")))
        selected = {s["id"] for s in batch["sources"] if s["supplier"] == supplier}
        item["samples"] = [s for s in item["samples"] if selected.intersection(s["sourceIds"])]
        if not item["samples"]:
            raise ValueError("请选择初检样本涉及的供应商")
        for sample in item["samples"]:
            sample["sourceIds"] = [sid for sid in sample["sourceIds"] if sid in selected]
            sample["poolCount"] = 1
            sample["portionCount"] = len(sample["sourceIds"]) if item.get("reportFormVersion") == 2 else 1
        sample_ids = {s["id"] for s in item["samples"]}
        for p in item["projects"]:
            p["sampleIds"] = [sid for sid in p["sampleIds"] if sid in sample_ids]
            p["results"], p["wells"], p["nc"], p["pc"] = {}, {}, "", ""
        item["samplingDate"] = item["testDate"] = item["conclusion"] = ""
    item.update(
        id=identifier(body["id"]),
        state="draft",
        updatedAt=now(),
        retestOf=entity_id if retest else before.get("retestOf", ""),
        correctionOf="" if retest else entity_id,
    )
    repo.save(conn, "tests", item, create=True)
    if not retest:
        for attachment in repo.all_items(conn, "attachments", entity_id):
            attachment.update(id=uuid4().hex, testId=item["id"])
            repo.save(conn, "attachments", attachment, create=True)
    from .workflow import reopen

    reopen(conn, user, repo.get(conn, "batches", before["batchId"]))
    audit(conn, user, "retest_created" if retest else "correction_created", before, item)
    return item


def split_retest_completed(tests, original_id, sample_id, supplier, sources):
    for test in tests:
        if test.get("retestOf") != original_id or test["state"] != "issued":
            continue
        sample = next((s for s in test["samples"] if s["id"] == sample_id), None)
        if not sample or {sources[sid]["supplier"] for sid in sample["sourceIds"]} != {supplier}:
            continue
        results = [p["results"].get(sample_id, "") for p in test["projects"] if sample_id in p["sampleIds"]]
        if results and all(r in {"negative", "positive", "suspect"} for r in results):
            return True
    return False
