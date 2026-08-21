"""Latest funding-book candidates for reimbursement registration."""

import re

from server_app.domains.iacuc.rules import normalize_iacuc_number
from server_app.repositories.billing_workflows import get_billing_workflow
from server_app.repositories.iacuc import list_experiment_application_payloads
from server_app.shared import clean_text

FUND_BOOK_LABELED = re.compile(r"经费本(?:编号|号)\s*[:：]\s*([0-9A-Za-z][0-9A-Za-z-]*)")
NON_FUND_BOOK_LABEL = re.compile(r"项目编号|基金号|基金编号")
TRAILING_TOKEN = re.compile(r"([0-9A-Za-z]+(?:-[0-9A-Za-z]+)*)\s*[)）]?\s*$")


def current_funding_book_options(conn, workflow_id):
    """Use the latest IACUC application import, never the workflow funding snapshot."""
    workflow = get_billing_workflow(conn, workflow_id)
    if not workflow:
        raise LookupError("结算流程不存在")
    iacucs = _workflow_iacucs(workflow)
    all_applications = list_experiment_application_payloads(conn)
    applications = [item for item in all_applications if normalize_iacuc_number(item.get("iacuc", "")) in iacucs]
    options = {}
    for application in applications:
        iacuc = clean_text(application.get("iacuc", ""))
        for value, label, source in _application_options(application):
            existing = options.get(value)
            if existing:
                if iacuc and iacuc not in existing["iacucs"]:
                    existing["iacucs"].append(iacuc)
                continue
            options[value] = {"value": value, "label": label, "source": source, "iacucs": [iacuc] if iacuc else []}
    pi_options = _pi_funding_book_options(all_applications, workflow)
    if not pi_options:
        pi_options = list(options.values())
    return {
        "items": list(options.values()),
        "iacucs": sorted(iacucs),
        "piFundingBookNos": sorted(pi_options),
        "piFundingBookOptions": list(pi_options.values()),
    }


def _workflow_iacucs(workflow):
    values = workflow.get("iacucs") or [workflow.get("iacuc", "")]
    return {normalized for value in values if (normalized := normalize_iacuc_number(value))}


def _application_options(application):
    funding = clean_text(application.get("funding", ""))
    project = clean_text(application.get("project", "")) or "实验申请"
    fund_codes = _split_values(application.get("fundCode", ""))
    if fund_codes:
        return [(value, _fund_code_label(value, funding, project), "fundCode") for value in fund_codes]
    return [(value, entry, "funding") for entry in _split_values(funding) if (value := _extract_funding_book_no(entry))]


def _pi_funding_book_options(applications, workflow):
    pi = clean_text(workflow.get("pi", ""))
    if not pi:
        return {}
    options = {}
    for application in applications:
        if clean_text(application.get("pi", "")) != pi:
            continue
        iacuc = clean_text(application.get("iacuc", ""))
        for value, label, source in _application_options(application):
            existing = options.get(value)
            if existing:
                if iacuc and iacuc not in existing["iacucs"]:
                    existing["iacucs"].append(iacuc)
                continue
            options[value] = {"value": value, "label": label, "source": source, "iacucs": [iacuc] if iacuc else []}
    return options


def _fund_code_label(value, funding, project):
    for entry in _split_values(funding):
        if _extract_funding_book_no(entry) == value:
            return entry
    return f"{project}（经费本编号：{value}）"


def _split_values(value):
    return [clean_text(entry) for entry in re.split(r"[、，,；;\n]+", clean_text(value)) if clean_text(entry)]


def _extract_funding_book_no(value):
    text = clean_text(value)
    labeled = FUND_BOOK_LABELED.search(text)
    if labeled:
        return labeled.group(1)
    if NON_FUND_BOOK_LABEL.search(text):
        return ""
    trailing = TRAILING_TOKEN.search(text)
    return trailing.group(1) if trailing and re.search(r"\d", trailing.group(1)) else ""
