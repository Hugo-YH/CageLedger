"""Diagnose persisted billing data without migrations, writes, or repricing."""

import json
import math
import sqlite3
from collections import Counter, defaultdict

from server_app.domains.billing.snapshot_codec import SnapshotStorageError
from server_app.repositories.billing_snapshot_storage import read_records
from server_app.shared.money_fields import money_difference, money_sum

from . import consistency_repository as repository


def _report_value(value):
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, dict):
        return {key: _report_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_report_value(item) for item in value]
    return value


class Review:
    def __init__(self):
        self.issues = []
        self.checks = []

    def issue(self, code, table, identity, message, *, severity="error", **detail):
        self.issues.append(
            {
                "code": code,
                "severity": severity,
                "table": table,
                "recordId": str(identity),
                "message": message,
                **_report_value(detail),
            }
        )

    def check(self, name, action, missing=()):
        if missing:
            self.checks.append({"name": name, "status": "skipped", "missing": sorted(missing)})
            return
        try:
            action()
        except (sqlite3.Error, ValueError, TypeError, KeyError, OverflowError) as exc:
            self.issue("check_failed", "", "", "检查未完成", check=name, reason=str(exc))
            self.checks.append({"name": name, "status": "failed"})
        else:
            self.checks.append({"name": name, "status": "completed"})

    def amounts(self, table, row, expected):
        for field, value in expected.items():
            if not math.isclose(float(row[field]), float(value), rel_tol=0, abs_tol=1e-9):
                self.issue(
                    "balance_mismatch",
                    table,
                    row["id"],
                    "存储金额与现行业务口径不一致",
                    field=field,
                    stored=row[field],
                    expected=value,
                )


def _confirmed_total(item):
    if not item:
        return 0.0
    if item["n"] == item["exact"]:
        return (item["cents"] or 0) / 100
    number = float(item["yuan"] or 0)
    return round(number, 2) if math.isfinite(number) else 0.0


def _sources(review, rows, totals):
    workflows, versions = rows["billing_workflows"], rows["billing_statement_versions"]
    for row in workflows.values():
        identity = row["current_version_id"]
        if not identity:
            continue  # A withdrawn workflow may have no current version.
        version = versions.get(identity)
        if not version or version["workflow_id"] != row["id"] or version["version_no"] != row["current_version_no"]:
            review.issue("workflow_version_mismatch", "billing_workflows", row["id"], "当前账单版本缺失或归属不一致")
    for row in rows["reimbursement_settlement_obligations"].values():
        if row["status"] == "void":
            continue  # Retained history is deliberately independent of a deleted workflow.
        version = versions.get(row["statement_version_id"])
        valid = row["workflow_id"] in workflows and version and version["workflow_id"] == row["workflow_id"]
        if not valid:
            confirmed = totals.get(row["id"], {}).get("n", 0)
            review.issue(
                "orphan_obligation",
                "reimbursement_settlement_obligations",
                row["id"],
                "应收来源不存在或版本归属不一致；现行有效应收列表已排除该记录",
                severity="error" if confirmed else "warning",
                confirmedAllocationCount=confirmed,
            )
        elif version["version_no"] != row["statement_version_no"]:
            review.issue(
                "obligation_version_number", "reimbursement_settlement_obligations", row["id"], "应收版本号不一致"
            )
        elif row["obligation_kind"] == "statement":
            try:
                payload = json.loads(version["payload"])
            except (ValueError, TypeError):
                continue  # Snapshot validation reports malformed JSON separately.
            if not isinstance(payload, dict) or not isinstance(payload.get("statement", {}), dict):
                continue
            try:
                amount = float(payload.get("statement", {}).get("totalAmount", 0) or 0)
                if not math.isfinite(amount):
                    raise ValueError("non-finite snapshot amount")
            except (ValueError, TypeError, OverflowError):
                review.issue(
                    "snapshot_amount_invalid", "billing_statement_versions", version["id"], "账单快照总金额无效"
                )
                continue
            review.amounts("reimbursement_settlement_obligations", row, {"payable_amount": round(amount, 2)})


def _allocations(review, rows):
    obligations = rows["reimbursement_settlement_obligations"]
    lines, claims = rows["reimbursement_claim_funding_lines"], rows["reimbursement_claims"]
    for row in lines.values():
        if row["claim_id"] not in claims:
            review.issue(
                "funding_line_orphan", "reimbursement_claim_funding_lines", row["id"], "经费明细所属报销单不存在"
            )
    for row in rows["reimbursement_allocations"].values():
        obligation, line = obligations.get(row["obligation_id"]), lines.get(row["funding_line_id"])
        if not obligation or not line:
            review.issue("allocation_orphan", "reimbursement_allocations", row["id"], "核销的应收或经费明细不存在")
        if row["status"] not in ("draft", "confirmed", "reversed"):
            review.issue("allocation_status", "reimbursement_allocations", row["id"], "核销状态无效")
        if not math.isfinite(float(row["amount"])) or float(row["amount"]) <= 0:
            review.issue("allocation_amount", "reimbursement_allocations", row["id"], "核销金额应为有限正数")
        if obligation and obligation["status"] == "void" and row["status"] == "confirmed":
            review.issue(
                "void_confirmed_allocation", "reimbursement_allocations", row["id"], "已撤销应收仍有已确认核销"
            )


def _balances(review, rows, line_totals, obligation_totals):
    lines_by_claim = defaultdict(list)
    for row in rows["reimbursement_claim_funding_lines"].values():
        allocated = _confirmed_total(line_totals.get(row["id"]))
        review.amounts(
            "reimbursement_claim_funding_lines",
            row,
            {
                "allocated_amount": allocated,
                "unallocated_amount": money_difference(row["reimbursement_amount"], allocated),
            },
        )
        if allocated > row["reimbursement_amount"] + 1e-9:
            review.issue(
                "funding_line_overallocated", "reimbursement_claim_funding_lines", row["id"], "核销超过经费明细金额"
            )
        lines_by_claim[row["claim_id"]].append((row["reimbursement_amount"], allocated))
    for row in rows["reimbursement_claims"].values():
        lines = lines_by_claim[row["id"]]
        total, allocated = money_sum(item[0] for item in lines), money_sum(item[1] for item in lines)
        review.amounts(
            "reimbursement_claims",
            row,
            {
                "total_amount": total,
                "allocated_amount": allocated,
                "unallocated_amount": money_difference(total, allocated),
            },
        )
    for row in rows["reimbursement_settlement_obligations"].values():
        totals = obligation_totals.get(row["id"], {})
        if row["status"] == "void":
            expected = {"allocated_amount": 0, "outstanding_amount": 0}
            count = 0
        else:
            allocated = _confirmed_total(totals)
            expected = {
                "allocated_amount": allocated,
                "outstanding_amount": money_difference(row["payable_amount"], allocated),
            }
            count = totals.get("line_count", 0)  # Business count is distinct funding lines, not claim IDs.
            if row["payable_amount"] >= 0 and allocated > row["payable_amount"] + 1e-9:
                review.issue(
                    "obligation_overallocated", "reimbursement_settlement_obligations", row["id"], "核销超过应收金额"
                )
        review.amounts("reimbursement_settlement_obligations", row, expected)
        if row["claim_count"] != count:
            review.issue(
                "obligation_claim_count",
                "reimbursement_settlement_obligations",
                row["id"],
                "已确认核销经费明细计数不一致",
                stored=row["claim_count"],
                expected=count,
            )


def _legacy_balances(conn, review):
    for row in repository.legacy_records(conn):
        # Legacy records are a parallel ledger; do not equate paid_amount with allocations.
        review.amounts(
            "reimbursement_records",
            row,
            {
                "unpaid_amount": max(money_difference(row["payable_amount"], row["paid_amount"]), 0),
                "accumulated_unpaid": money_difference(row["accumulated_payable"], row["accumulated_paid"]),
            },
        )


def _snapshots(conn, review):
    for version, payload in conn.execute("SELECT id,payload FROM billing_statement_versions ORDER BY id"):
        try:
            header = json.loads(payload)
            if not isinstance(header, dict) or not isinstance(header.get("statement", {}), dict):
                raise ValueError("账单版本JSON结构无效")
            for _, _, line in read_records(conn, version):
                if not isinstance(json.loads(line), dict):
                    raise ValueError("账单明细JSON结构无效")
        except (SnapshotStorageError, ValueError, TypeError) as exc:
            review.issue(
                "snapshot_invalid",
                "billing_statement_versions",
                version,
                "账单快照无法完整读取或校验失败",
                reason=str(exc),
            )


def _cent_mirrors(conn, schema, review, coverage):
    missing, fractional, mismatches, invalid = repository.cent_findings(conn, schema)
    coverage.update({"missingCentColumns": missing, "legacyFallbacks": [item for item in fractional if item["count"]]})
    for table, identity, field, stored, expected in mismatches:
        review.issue(
            "cent_mirror_mismatch", table, identity, "元与分字段不一致", field=field, stored=stored, expected=expected
        )
    for table, identity, field in invalid:
        review.issue("money_invalid", table, identity, "金额字段不是有限数值", field=field)


def check_consistency(conn):
    """Caller supplies a stable read-only copy. Never initialize or repair schema."""
    conn.row_factory = sqlite3.Row
    review, coverage = Review(), {}
    schema = repository.schema_columns(conn)
    integrity = [row[0] for row in conn.execute("PRAGMA integrity_check")]
    if integrity != ["ok"]:
        review.issue("sqlite_integrity", "", "", "SQLite完整性检查失败", details=integrity)
    for row in conn.execute("PRAGMA foreign_key_check"):
        review.issue(
            "foreign_key_violation", row[0], row[1], "已声明外键关联失效", parentTable=row[2], foreignKeyIndex=row[3]
        )
    review.checks.append({"name": "sqlite_integrity_and_foreign_keys", "status": "completed"})
    missing = [
        f"{table}.{field}"
        for table, fields in repository.LEDGER_COLUMNS.items()
        for field in fields
        if field not in schema.get(table, set())
    ]

    def ledger():
        rows = repository.ledger_rows(conn)
        line_totals = repository.confirmed_totals(conn, schema, "funding_line_id")
        obligation_totals = repository.confirmed_totals(conn, schema, "obligation_id")
        coverage["rowCounts"] = {table: len(items) for table, items in rows.items()}
        _sources(review, rows, obligation_totals)
        _allocations(review, rows)
        _balances(review, rows, line_totals, obligation_totals)

    review.check("ledger_sources_and_balances", ledger, missing)
    legacy_fields = {
        "id",
        "payable_amount",
        "paid_amount",
        "unpaid_amount",
        "accumulated_payable",
        "accumulated_paid",
        "accumulated_unpaid",
    }
    review.check(
        "legacy_ledger_balances",
        lambda: _legacy_balances(conn, review),
        legacy_fields - schema.get("reimbursement_records", set()),
    )
    snapshot_missing = [
        f"{table}.{field}"
        for table, fields in {
            "billing_statement_versions": ("id", "payload"),
            "billing_statement_version_lines": ("id", "version_id", "line_date", "payload"),
        }.items()
        for field in fields
        if field not in schema.get(table, set())
    ]
    review.check("bill_snapshots", lambda: _snapshots(conn, review), snapshot_missing)
    review.check("cent_mirrors", lambda: _cent_mirrors(conn, schema, review, coverage))
    counts = Counter(item["severity"] for item in review.issues)
    incomplete = any(item["status"] != "completed" for item in review.checks)
    status = "incomplete" if incomplete else "error" if counts["error"] else "warning" if counts["warning"] else "ok"
    return {
        "reportVersion": 1,
        "status": status,
        "readOnly": True,
        "summary": {
            "errors": counts["error"],
            "warnings": counts["warning"],
            "incomplete": incomplete,
            "byCode": dict(sorted(Counter(item["code"] for item in review.issues).items())),
        },
        "checks": review.checks,
        "coverage": coverage,
        "issues": review.issues,
    }
