"""Create a checked backup bundle, restore it elsewhere, and exercise current code."""

import json
import os
import signal
import subprocess
import sys
import uuid
from contextlib import closing
from pathlib import Path

from scripts.database_review.runner import (
    code_fingerprint,
    differences,
    runtime_environment,
    validate_checks,
    worker_environment,
)
from scripts.database_review.storage import (
    backup_copy,
    fingerprint,
    immutable_connection,
    offline_input,
    private_output,
    source_scope,
    write_json,
)

from .files import copy_file, copy_tree, file_fact, inventory, safe_input
from .references import references, validate_references


def code_inventory(code_root):
    result = code_fingerprint(code_root)
    for path in (code_root / "scripts/restore_drill").rglob("*.py"):
        result[path.relative_to(code_root).as_posix()] = file_fact(path)["sha256"]
    for name in ("scripts/verify_restore.py", "package.json"):
        result[name] = file_fact(code_root / name)["sha256"]
    return result


def restore_environment(database, runtime):
    runtime = Path(runtime)
    env = worker_environment(Path(database), runtime)
    env.update(
        {
            "CAGELEDGER_ANIMAL_INSPECTION_IMAGES": str(runtime / "files/animal-inspections/reference-images"),
            "CAGELEDGER_ANIMAL_INSPECTION_ATTACHMENTS": str(runtime / "files/animal-inspections/attachments"),
            "CAGELEDGER_REIMBURSEMENT_ATTACHMENTS": str(runtime / "files/reimbursements/attachments"),
        }
    )
    # This is an executable path consumed by the existing isolated Writer renderer.
    if os.environ.get("CAGELEDGER_LIBREOFFICE_BIN"):
        env["CAGELEDGER_LIBREOFFICE_BIN"] = os.environ["CAGELEDGER_LIBREOFFICE_BIN"]
    return env


def run_worker(request_path, log, timeout):
    request = json.loads(request_path.read_text())
    env = restore_environment(request["database"], request["runtime"])
    with log.open("xb") as stream:
        os.chmod(log, 0o600)
        process = subprocess.Popen(
            [sys.executable, str(Path(__file__).with_name("worker.py")), str(request_path)],
            cwd=request["code"],
            env=env,
            stdout=stream,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            return process.wait(timeout=timeout)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)


def human_report(report):
    lines = [
        "# 备份恢复演练",
        "",
        f"结果：`{report['status']}`。",
        "",
        f"原数据库及伴随文件不变：{report['databaseUnchanged']}；原附件不变：{report['filesUnchanged']}；代码不变：{report['codeUnchanged']}。",
        "",
    ]
    manifest = report.get("manifest", {})
    if manifest:
        lines += [
            f"清单保留 {len(manifest['files']['files'])} 个文件、{sum(f['bytes'] for f in manifest['files']['files'].values())} 字节，含未被当前记录引用的历史文件。",
            "",
        ]
    summary = report.get("summary")
    if summary:
        bills = summary["exports"]
        lines += [
            f"- 原表 {summary['sourceTables']} 张、记录 {summary['sourceRows']} 条；原审计全文 {summary['originalAuditEvents']} 条。",
            f"- 核算 {summary['calculations']} 组；账单快照 {bills['bills']} 份、完整行 {bills['lineRows']} 行；HTML/Excel 各 {bills['bills']} 份。",
            f"- PDF {bills['pdf']}/{bills['bills']} 份，模式 {bills['pdfMode']}；每份独立库业务HTTP {summary['httpRequestsPerCopy']} 次。",
            f"- 对照与恢复结果差异 {len(report['differences'])} 项；附件HTTP下载 {summary['attachmentDownloads']} 次。",
            "",
        ]
    issues = report.get("referenceIssues", [])
    lines += [f"数据库附件引用异常：{len(issues)} 项。", ""]
    for item in issues:
        lines.append(f"- {item['reason']}：`{item['path']}`（{item['kind']}，{item['id']}）")
    failures = report.get("attachmentChecks", {}).get("errors", [])
    lines += ["", f"附件HTTP核验失败：{len(failures)} 项。"]
    for item in failures:
        lines.append(f"- `{item['path']}`：{item['error']}")
    remote = report.get("remoteReferences", [])
    lines += ["", f"远端附件 {len(remote)} 项未联网验证；完整清单见 report.json。"]
    if report.get("error"):
        lines += ["", "未完成原因：" + report["error"]]
    lines += [
        "",
        "passed_with_warnings 保留已有业务警告及远端依赖，不代表脱离Gitea也能恢复远端附件。",
        "本工具不覆盖部署配置、运行日志、外部服务、生产切换和浏览器像素版式；未生成的实际后续业务数据无法由备份证明。",
        "旧应收GET同步及升级留档只在新副本内按现行规则发生；原业务记录不被修复或覆盖。",
        "恢复与对照共用当前安装运行时和依赖；实际版本见report.json的runtime，不证明旧版独立依赖环境或容器重建兼容。",
        "bundle/ 为带清单的备份，restored/runtime/ 为实际恢复目录，control/ 为独立数据库对照；均含业务信息，不提交Git。",
        "",
    ]
    return "\n".join(lines)


def drill(source, files, output, code_root, *, pdf_samples="3", timeout=900):
    if timeout <= 0 or pdf_samples != "all" and (not str(pdf_samples).isdigit() or int(pdf_samples) <= 0):
        raise ValueError("超时及PDF样本数须为正数；PDF也可选all")
    code_root = Path(code_root).resolve()
    source = safe_input(source)
    files = safe_input(files, directory=True)
    if source == files or files in source.parents:
        raise ValueError("数据库不能放在所选附件目录内")
    candidate = Path(output).absolute()
    if any(p.is_symlink() for p in (candidate, *candidate.parents)):
        raise ValueError("输出路径不能含符号链接")
    candidate = candidate.resolve()
    if candidate == files or candidate in files.parents or files in candidate.parents:
        raise ValueError("输出目录与原附件目录不能重叠")
    # Sidecars are also inputs, never follow them to another location.
    for suffix in ("-wal", "-shm", "-journal"):
        if Path(str(source) + suffix).is_symlink():
            raise ValueError("数据库伴随文件不能是符号链接")
    source, before = offline_input(source)
    files_before = inventory(files)
    output = private_output(candidate, source, code_root)
    report = {
        "reportVersion": 1,
        "completed": False,
        "status": "incomplete",
        "database": str(source),
        "files": str(files),
        "databaseBefore": before,
        "filesBefore": files_before,
        "codeBefore": None,
        "runtime": None,
    }
    try:
        report["runtime"] = runtime_environment(code_root)
        report["codeBefore"] = code_inventory(code_root)
        with closing(immutable_connection(source)) as conn:
            if (
                conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok"
                or conn.execute("PRAGMA foreign_key_check").fetchall()
            ):
                raise ValueError("输入SQLite完整性或外键检查失败")
            scope, refs = source_scope(conn), references(conn)
        write_json(output / "source-scope.json", scope)
        report["referenceIssues"] = validate_references(refs, files_before)
        report["remoteReferences"] = refs["remote"]
        report["revision"] = subprocess.check_output(
            ["git", "-C", str(code_root), "rev-parse", "HEAD"], text=True
        ).strip()
        bundle = output / "bundle"
        bundle.mkdir(mode=0o700)
        manifest = {"format": "cageledger-restore-drill-v1", "database": before["main"], "files": files_before}
        report["manifest"] = manifest
        copy_file(source, bundle / "database/cageledger.sqlite", manifest["database"])
        copy_tree(files, bundle / "files", files_before)
        write_json(bundle / "manifest.json", manifest)
        manifest = json.loads((bundle / "manifest.json").read_text())
        if manifest != report["manifest"]:
            raise ValueError("备份包清单写入校验失败")
        # Restore only from the new bundle; no application opens the supplied originals.
        restored = output / "restored/runtime"
        restored.mkdir(parents=True, mode=0o700)
        copy_file(bundle / "database/cageledger.sqlite", restored / "database/cageledger.sqlite", manifest["database"])
        copy_tree(bundle / "files", restored / "files", files_before)
        report["bundleVerified"] = True
        outputs = {}
        fixture = "restore-drill-" + uuid.uuid4().hex
        for case in ("control", "restored"):
            folder = output / case
            runtime = folder / "runtime"
            database = runtime / "database/cageledger.sqlite"
            if case == "control":
                database.parent.mkdir(parents=True, mode=0o700)
                backup_copy(source, database)
            request_path = folder / "request.json"
            write_json(
                request_path,
                {
                    "case": case,
                    "code": str(code_root),
                    "database": str(database),
                    "runtime": str(runtime),
                    "result": str(folder / "result.json"),
                    "scope": scope,
                    "fixturePrefix": fixture,
                    "pdfSamples": pdf_samples,
                    "references": refs,
                    "filesManifest": files_before,
                },
            )
            print(json.dumps({"stage": "checking", "case": case}, ensure_ascii=False), flush=True)
            exit_code = run_worker(request_path, folder / "worker.log", timeout)
            result = folder / "result.json"
            outputs[case] = json.loads(result.read_text()) if result.exists() else {"completed": False}
            if exit_code or not outputs[case]["completed"]:
                raise ValueError(f"{case}核验未完成，见对应result.json及worker.log")
            validate_checks(outputs[case]["checks"], scope, pdf_samples)
        control, current = (outputs[case]["checks"] for case in ("control", "restored"))
        report["differences"] = differences(control, current)
        assets = outputs["restored"]["attachments"]
        report["attachmentChecks"] = assets
        expected = len(refs["local"])
        if sum(len(assets[key]) for key in ("downloads", "errors", "storageOnly", "missing")) != expected:
            raise ValueError("附件核验覆盖不完整")
        report["summary"] = {
            "sourceTables": len(scope),
            "sourceRows": sum(len(s["rows"]) for s in scope.values()),
            "originalAuditEvents": len(current["auditFacts"]),
            "calculations": len(current["calculations"]),
            "exports": current["bills"]["coverage"],
            "httpRequestsPerCopy": current["http"]["requests"],
            "attachmentDownloads": len(assets["downloads"]),
            "storageOnly": len(assets["storageOnly"]),
            "warnings": current["consistency"]["summary"]["warnings"],
            "historicalFindings": current["historicalFindings"],
        }
        report["completed"] = True
        if report["differences"] or report["referenceIssues"] or assets["errors"] or assets["missing"]:
            report["status"] = "failed"
        elif refs["remote"] or report["summary"]["warnings"] or current["historicalFindings"].get("needsReview", 0):
            report["status"] = "passed_with_warnings"
        else:
            report["status"] = "passed"
    except Exception as exc:  # noqa: BLE001 - never mistake interrupted or incomplete checks for success.
        report.update(errorType=type(exc).__name__, error=str(exc))
    finally:
        try:
            report["databaseAfter"] = fingerprint(source)
            report["filesAfter"] = inventory(files)
            report["databaseUnchanged"] = before == report["databaseAfter"]
            report["filesUnchanged"] = files_before == report["filesAfter"]
        except Exception as exc:  # noqa: BLE001 - deleted/changed input must invalidate the run.
            report.update(databaseUnchanged=False, filesUnchanged=False, inputCheckError=str(exc))
        try:
            after = code_inventory(code_root)
            report["codeUnchanged"] = report["codeBefore"] is not None and report["codeBefore"] == after
        except Exception as exc:  # noqa: BLE001 - even removal of a tool must leave a failed report.
            report.update(codeUnchanged=False, codeCheckError=str(exc))
        if not report["databaseUnchanged"] or not report["filesUnchanged"]:
            report["status"] = "input_changed"
        if report["codeBefore"] is None or "codeCheckError" in report:
            report["status"] = (
                "incomplete" if report["databaseUnchanged"] and report["filesUnchanged"] else "input_changed"
            )
        elif not report["codeUnchanged"]:
            report["status"] = "code_changed"
        if not report["databaseUnchanged"] or not report["filesUnchanged"] or not report["codeUnchanged"]:
            report["completed"] = False
        write_json(output / "report.json", report)
        path = output / "report.md"
        with path.open("x", encoding="utf-8") as stream:
            os.chmod(path, 0o600)
            stream.write(human_report(report))
    return report
