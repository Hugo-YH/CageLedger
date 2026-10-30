"""Compare two code revisions in isolated subprocesses and preserve private evidence."""

import hashlib
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import uuid
from contextlib import closing
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from .storage import (
    backup_copy,
    digest,
    fingerprint,
    immutable_connection,
    offline_input,
    private_output,
    require_original_rows,
    source_scope,
    write_json,
)


def require_export_ids(scope, table, identities):
    if table not in scope:
        return
    expected = scope[table].get("exportIdHashes")
    if expected is None:
        raise ValueError(f"缺少原始记录ID覆盖证据: {table}")
    if not set(expected) <= {digest(str(identity)) for identity in identities}:
        raise ValueError(f"原始记录ID覆盖不完整: {table}")


def validate_checks(checks, scope, pdf_samples):
    required = {
        "migration",
        "afterReads",
        "auditFacts",
        "auditReadableCount",
        "auditReadableAfterReads",
        "bills",
        "calculations",
        "quantityHtml",
        "http",
        "consistency",
        "historicalFindings",
    }
    if not required <= checks.keys():
        raise ValueError("核查结果缺少必需阶段，不能视为完成")
    for key in ("migration", "afterReads"):
        require_original_rows(checks[key], scope)
    audit_count = len(scope.get("audit_events", {}).get("rows", {}))
    if len(checks["auditFacts"]) != audit_count or checks["auditReadableCount"] < audit_count:
        raise ValueError("原审计全文覆盖不完整")
    require_export_ids(scope, "audit_events", checks["auditFacts"])
    if checks["auditReadableAfterReads"] < checks["auditReadableCount"] + len(checks["http"]["syncAudits"]):
        raise ValueError("HTTP读取后的全部审计覆盖不完整")
    bills = checks["bills"]
    require_export_ids(scope, "billing_statement_versions", bills["snapshots"])
    identities = set(bills["snapshots"])
    if set(bills["html"]) != identities or set(bills["xlsx"]) != identities or not set(bills["pdf"]) <= identities:
        raise ValueError("账单导出ID与快照不一致")
    total = len(bills["snapshots"])
    coverage = bills["coverage"]
    expected_pdf = total if pdf_samples == "all" else min(total, int(pdf_samples))
    if (
        any(coverage[key] != len(bills[key]) for key in ("html", "xlsx", "pdf"))
        or coverage["bills"] != total
        or coverage["pdf"] != expected_pdf
    ):
        raise ValueError("账单、HTML、Excel或PDF覆盖不完整")
    if total < len(scope.get("billing_statement_versions", {}).get("rows", {})) or coverage["lineRows"] < len(
        scope.get("billing_statement_version_lines", {}).get("rows", {})
    ):
        raise ValueError("原账单快照或完整行记录覆盖不足")
    if (
        len(checks["quantityHtml"]) < len(scope.get("quantity_sheets", {}).get("rows", {}))
        or checks["http"]["requests"] <= 0
    ):
        raise ValueError("数量表或实际HTTP覆盖不足")
    require_export_ids(scope, "quantity_sheets", checks["quantityHtml"])
    summary = checks["consistency"]["summary"]
    if summary["errors"] or summary["incomplete"]:
        raise ValueError("账务检查有错误或未完成")


def human_report(report):
    summary = report.get("summary", {})
    exports = summary.get("exports", {})
    lines = [
        "# 数据库副本兼容核查",
        "",
        f"结果：`{report['status']}`。",
        "",
        f"输入文件保持不变：{report['inputUnchanged']}；核查期间代码保持不变：{report['codeUnchanged']}。",
        "",
        f"基准提交：{report.get('baselineRevision', '未完成')}；当前提交：{report.get('currentRevision', '未完成')}（另记录工作区代码指纹）。",
        "",
    ]
    if report.get("completed"):
        lines += [
            f"- 原有业务表：{summary['sourceTables']} 张，原有记录：{summary['sourceRows']} 条。",
            f"- 原审计全文：{summary['originalAuditEvents']} 条；启动后可读取审计：{summary['auditReadableCount']} 条；读取同步后：{summary['auditReadableAfterReads']} 条。",
            f"- 完整账单：{exports['bills']} 份、{exports['lineRows']} 行；HTML：{exports['html']} 份；Excel：{exports['xlsx']} 份。",
            f"- PDF：{exports['pdf']} / {exports['bills']} 份，模式 `{exports['pdfMode']}`；仅当数量相等时才覆盖全部账单PDF。",
            f"- 重新核算范围：{summary['calculations']} 组；每版真实HTTP读取：{summary['httpRequestsPerRevision']} 次。",
            f"- 差异项：{len(report['differences'])}；既有账务警告：{summary['warnings']}。",
            f"- 既有历史问题分类：{json.dumps(summary['historicalFindings'], ensure_ascii=False)}。",
            f"- 应收读取触发的同步审计：{summary['readTriggeredSyncAuditCount']} 条，核对原有行为；只在独立副本执行。",
            "",
            "passed_with_warnings 表示两版兼容比对通过，但保留既有历史问题，不表示业务数据全部无异常。",
        ]
    if report.get("error"):
        lines += [f"未完成原因：{report['error']}", ""]
    lines += [
        "",
        "基准与当前代码共用已安装运行时和依赖；版本见report.json的runtime，清单和运行时指纹纳入变化检查。这不证明旧版独立依赖环境或容器重建兼容。",
        "完整机器结果见 report.json；各阶段证据及隔离数据库位于 baseline/ 和 current/。",
        "数据库外附件、外部服务及生产部署未检查。数据库副本和报告可能包含业务信息，请妥善保管，不提交到Git。",
        "",
    ]
    return "\n".join(lines)


def differences(left, right, path=""):
    if isinstance(left, dict) and isinstance(right, dict):
        result = []
        for key in sorted(left.keys() | right.keys()):
            at = path + "/" + str(key)
            if key not in left or key not in right:
                result.append(at)
            else:
                result.extend(differences(left[key], right[key], at))
        return result
    return [] if left == right else [path]


def runtime_environment(code_root):
    python_dependencies = {}
    for name in ("openpyxl", "playwright", "python-docx", "Pillow", "pypdf"):
        try:
            python_dependencies[name] = version(name)
        except PackageNotFoundError:
            python_dependencies[name] = None
    node_dependencies = {}
    for name in ("react", "react-dom", "antd", "@ant-design/plots", "playwright", "vite", "vitepress"):
        path = code_root / "node_modules" / name / "package.json"
        node_dependencies[name] = json.loads(path.read_text())["version"] if path.is_file() else None
    node = shutil.which("node")
    return {
        "python": sys.version.split()[0],
        "sqlite": sqlite3.sqlite_version,
        "node": subprocess.check_output([node, "--version"], text=True).strip() if node else None,
        "pythonDependencies": python_dependencies,
        "nodeDependencies": node_dependencies,
        "dependencyMode": "shared-installed-runtime",
    }


def code_fingerprint(code_root):
    paths = (
        "server.py",
        "server_app",
        "src",
        "scripts/database_review",
        "scripts/verify_database_copy.py",
        "scripts/render_pdf.mjs",
        "scripts/restore_drill",
        "scripts/verify_restore.py",
        "scripts/python_runtime.mjs",
        "scripts/check_python_runtime.mjs",
        "scripts/run_python.mjs",
        "package.json",
        "package-lock.json",
        "requirements.txt",
        "requirements-dev.txt",
        ".python-version",
        ".nvmrc",
        "vite.config.ts",
        "tsconfig.json",
    )
    files = set()
    for options in (("--cached",), ("--others", "--exclude-standard")):
        files.update(
            subprocess.check_output(["git", "-C", str(code_root), "ls-files", "-z", *options, "--", *paths])
            .decode()
            .split("\0")
        )
    result = {}
    for name in sorted(files - {""}):
        path = code_root / name
        if path.is_file():
            with path.open("rb") as stream:
                result[name] = hashlib.file_digest(stream, "sha256").hexdigest()
    result["runtime:environment"] = digest(runtime_environment(code_root))
    return result


def baseline_checkout(code_root, output, ref):
    revision = subprocess.check_output(
        ["git", "-C", str(code_root), "rev-parse", "--verify", "--end-of-options", ref + "^{commit}"], text=True
    ).strip()
    archive = output / "baseline.tar"
    with archive.open("xb") as stream:
        os.chmod(archive, 0o600)
        subprocess.run(["git", "-C", str(code_root), "archive", "--format=tar", revision], stdout=stream, check=True)
    checkout = output / "baseline-code"
    checkout.mkdir(mode=0o700)
    with tarfile.open(archive) as bundle:
        bundle.extractall(checkout, filter="data")
    archive.unlink()
    # Reuse installed runtime dependencies; do not install or edit them.
    if (code_root / "node_modules").is_dir():
        (checkout / "node_modules").symlink_to(code_root / "node_modules", target_is_directory=True)
    return revision, checkout


def worker_environment(database, runtime):
    env = {key: value for key, value in os.environ.items() if not key.startswith("CAGELEDGER_") and key != "PYTHONPATH"}
    env.update(
        {
            "PYTHONDONTWRITEBYTECODE": "1",
            "CAGELEDGER_DB": str(database),
            "CAGELEDGER_DATA_ROOT": str(runtime),
            "CAGELEDGER_IACUC_INDEX": str(runtime / "indexes/iacuc/index.json"),
            "CAGELEDGER_PDF_CACHE": str(runtime / "cache/pdf"),
            "CAGELEDGER_LOG_DIR": str(runtime / "logs"),
            "CAGELEDGER_LOG_PERSISTENCE_ENABLED": "0",
            "CAGELEDGER_PERFORMANCE_HISTORY_ENABLED": "0",
            "CAGELEDGER_ANIMAL_INSPECTION_IMAGES": str(runtime / "files/inspection-images"),
            "CAGELEDGER_ANIMAL_INSPECTION_ATTACHMENTS": str(runtime / "files/inspection-attachments"),
            "CAGELEDGER_REIMBURSEMENT_ATTACHMENTS": str(runtime / "files/reimbursement-attachments"),
            "CAGELEDGER_GITEA_TOKEN": "",
            "CAGELEDGER_REPOSITORY_URL": "http://127.0.0.1:1/disabled",
            "CAGELEDGER_IACUC_AUTO_IMPORT_ENABLED": "0",
            "CAGELEDGER_UPDATE_CHECK_ENABLED": "false",
            "DEEPSEEK_API_KEY": "",
        }
    )
    return env


def run_worker(worker, request, log, timeout):
    with log.open("xb") as stream:
        os.chmod(log, 0o600)
        process = subprocess.Popen(
            [sys.executable, str(worker), str(request)],
            env=worker_environment_from_request(request),
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


def worker_environment_from_request(request):
    value = json.loads(request.read_text())
    return worker_environment(Path(value["database"]), Path(value["runtime"]))


def review(source, output, code_root, baseline_ref, *, pdf_samples="3", timeout=900):
    source, before = offline_input(source)
    output = private_output(output, source, code_root)
    report = {
        "reportVersion": 1,
        "completed": False,
        "status": "incomplete",
        "input": str(source),
        "inputBefore": before,
        "limits": [
            "数据库外附件、外部服务和生产部署不在本工具覆盖范围",
            "PDF按pdfMode标明样本或全量，不将抽样称为全部PDF验证",
            "基准与当前代码共用已安装的运行时和依赖，不证明旧版独立依赖环境或容器重建兼容；记录版本和锁文件指纹",
        ],
        "runtime": None,
        "currentCodeBefore": None,
    }
    try:
        report["runtime"] = runtime_environment(code_root)
        report["currentCodeBefore"] = code_fingerprint(code_root)
        with closing(immutable_connection(source)) as conn:
            if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("输入数据库完整性检查失败")
            scope = source_scope(conn)
        write_json(output / "source-scope.json", scope)
        report["baselineRevision"], baseline = baseline_checkout(code_root, output, baseline_ref)
        report["currentRevision"] = subprocess.check_output(
            ["git", "-C", str(code_root), "rev-parse", "HEAD"], text=True
        ).strip()
        report["currentWorktreeDiff"] = subprocess.check_output(
            ["git", "-C", str(code_root), "diff", "--stat"], text=True
        )
        fixture_prefix = "copy-review-" + uuid.uuid4().hex
        outputs = {}
        for case, code in (("baseline", baseline), ("current", code_root)):
            folder = output / case
            folder.mkdir(mode=0o700)
            runtime = folder / "runtime"
            runtime.mkdir(mode=0o700)
            database = runtime / "review.sqlite"
            backup_copy(source, database)
            if fingerprint(source) != before:
                raise ValueError("输入在复制期间发生变化")
            request = folder / "request.json"
            result = folder / "result.json"
            write_json(
                request,
                {
                    "case": case,
                    "code": str(code),
                    "database": str(database),
                    "runtime": str(runtime),
                    "result": str(result),
                    "scope": scope,
                    "fixturePrefix": fixture_prefix,
                    "pdfSamples": pdf_samples,
                },
            )
            print(
                json.dumps({"stage": "checking", "case": case, "output": str(folder)}, ensure_ascii=False), flush=True
            )
            exit_code = run_worker(Path(__file__).with_name("worker.py"), request, folder / "worker.log", timeout)
            outputs[case] = (
                json.loads(result.read_text())
                if result.exists()
                else {"completed": False, "error": "进程未生成完整结果"}
            )
            if exit_code or not outputs[case]["completed"]:
                raise ValueError(f"{case}核查未完成，详情见隔离目录的result.json和worker.log")
            validate_checks(outputs[case]["checks"], scope, pdf_samples)
        baseline, current = (outputs[case]["checks"] for case in ("baseline", "current"))
        changed = differences(baseline, current)
        report.update(
            {
                "completed": True,
                "differences": changed,
                "summary": {
                    "sourceTables": len(scope),
                    "sourceRows": sum(len(spec["rows"]) for spec in scope.values()),
                    "originalAuditEvents": len(current["auditFacts"]),
                    "auditReadableCount": current["auditReadableCount"],
                    "auditReadableAfterReads": current["auditReadableAfterReads"],
                    "calculations": len(current["calculations"]),
                    "httpRequestsPerRevision": current["http"]["requests"],
                    "exports": current["bills"]["coverage"],
                    "warnings": current["consistency"]["summary"]["warnings"],
                    "historicalFindings": current["historicalFindings"],
                    "readTriggeredSyncAuditCount": len(current["http"]["syncAudits"]),
                },
            }
        )
        report["status"] = (
            "different"
            if changed
            else "passed_with_warnings"
            if report["summary"]["warnings"] or report["summary"]["historicalFindings"].get("needsReview", 0)
            else "passed"
        )
    except Exception as exc:  # noqa: BLE001 - an interrupted stage is not a successful review.
        report.update(errorType=type(exc).__name__, error=str(exc))
    finally:
        try:
            report["inputAfter"] = fingerprint(source)
            report["inputUnchanged"] = before == report["inputAfter"]
        except Exception as exc:  # noqa: BLE001 - failed evidence capture must leave a nonpassing report.
            report.update(inputUnchanged=False, inputCheckError=str(exc))
        if not report["inputUnchanged"]:
            report["status"] = "input_changed"
        try:
            report["currentCodeAfter"] = code_fingerprint(code_root)
            report["codeUnchanged"] = (
                report["currentCodeBefore"] is not None and report["currentCodeBefore"] == report["currentCodeAfter"]
            )
        except Exception as exc:  # noqa: BLE001 - even missing runtime metadata must preserve failed evidence.
            report.update(codeUnchanged=False, codeCheckError=str(exc))
        if report["currentCodeBefore"] is None or "codeCheckError" in report:
            report["status"] = "incomplete" if report["inputUnchanged"] else "input_changed"
        elif not report["codeUnchanged"]:
            report["status"] = "code_changed"
        if not report["inputUnchanged"] or not report["codeUnchanged"]:
            report["completed"] = False
        write_json(output / "report.json", report)
        with (output / "report.md").open("x", encoding="utf-8") as stream:
            os.chmod(stream.name, 0o600)
            stream.write(human_report(report))
        (output / "README.txt").write_text(
            "本目录含生产数据副本及核查证据，须妥善保管，不得提交到Git。\nreport.json标明结果及覆盖；完整结果分别在baseline和current目录。\n输入原库不被写入；应收GET同步仅发生于本目录的隔离副本。\n",
            encoding="utf-8",
        )
        os.chmod(output / "README.txt", 0o600)
    return report
