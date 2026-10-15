"""Compare complete stored bills and calculations without persisting a settlement."""

import io
import json
from decimal import Decimal
from unittest.mock import patch

from .storage import digest


def excel_digest(data):
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(data), data_only=False)
    try:
        return digest(
            [
                (
                    sheet.title,
                    sorted(str(item) for item in sheet.merged_cells.ranges),
                    [
                        (cell.coordinate, cell.value, cell.data_type, cell.number_format)
                        for row in sheet
                        for cell in row
                        if cell.value is not None
                    ],
                )
                for sheet in workbook
            ]
        )
    finally:
        workbook.close()


def clean_calculation(statement, lines):
    # These IDs/times are newly produced preview metadata. Stored snapshots,
    # historical dates and source-record versions are never normalized away.
    if statement.get("workflowId"):
        return statement, lines
    statement = {key: value for key, value in statement.items() if key not in ("id", "generatedAt")}
    lines = [{key: value for key, value in row.items() if key not in ("id", "statementId")} for row in lines]
    return statement, lines


def stored_bills(conn, pdf_samples):
    from server_app.domains.billing.settlement_export import build_settlement_workbook
    from server_app.pdf.documents import billing_statement_html, render_billing_statement_pdf
    from server_app.repositories.billing_statements import list_billing_statement_lines_for_version

    result = {"snapshots": {}, "html": {}, "xlsx": {}, "pdf": {}}
    samples = []
    line_count = 0
    for row in conn.execute("SELECT id,payload FROM billing_statement_versions ORDER BY id"):
        version = json.loads(row["payload"])
        statement = version.get("statement") or {}
        lines = list_billing_statement_lines_for_version(conn, row["id"])
        line_count += len(lines)
        total = Decimal(str(statement.get("totalAmount", 0)))
        summed = sum((Decimal(str(line.get("amount", 0))) for line in lines), Decimal(0))
        last = Decimal(str(lines[-1].get("cumulative", 0))) if lines else Decimal(0)
        if not total.is_finite() or abs(total - summed) > Decimal("0.005") or abs(total - last) > Decimal("0.005"):
            raise ValueError(f"账单头、明细及累计金额不一致: {row['id']}")
        result["snapshots"][row["id"]] = digest((version, lines))
        result["html"][row["id"]] = digest(billing_statement_html(statement, lines))
        result["xlsx"][row["id"]] = excel_digest(build_settlement_workbook([(statement, lines)]))
        samples.append((row["id"], statement, lines))
    # First cover distinct sources, then the largest statements for page breaks.
    samples.sort(key=lambda item: (-len(item[2]), item[0]))
    selected, sources = [], set()
    limit = len(samples) if pdf_samples == "all" else int(pdf_samples)
    for item in samples:
        source = item[1].get("sourceType", "")
        if source not in sources and len(selected) < limit:
            sources.add(source)
            selected.append(item)
    for item in samples:
        if len(selected) < limit and item[0] not in {entry[0] for entry in selected}:
            selected.append(item)
    if selected:
        from pypdf import PdfReader

        for identity, statement, lines in selected:
            body = render_billing_statement_pdf(statement, lines)
            reader = PdfReader(io.BytesIO(body))
            texts = [page.extract_text() for page in reader.pages]
            if not texts or not any(text and text.strip() for text in texts):
                raise ValueError(f"PDF没有可核对的文本: {identity}")
            result["pdf"][identity] = {"pages": len(texts), "text": digest(texts)}
    result["coverage"] = {
        "lineRows": line_count,
        "bills": len(samples),
        "html": len(samples),
        "xlsx": len(samples),
        "pdf": len(selected),
        "pdfMode": pdf_samples,
    }
    return result


def calculations(conn):
    from server_app.composition import generate_billing_statement_by_pi
    from server_app.domains.billing import generation

    groups = {
        (row[0], row[1], "quantity_sheet") for row in conn.execute("SELECT DISTINCT month,pi FROM quantity_sheets")
    }
    groups.update(
        (row[0], row[1], "pi_merged_technical_service")
        for row in conn.execute("SELECT DISTINCT month,pi FROM technical_service_sheets WHERE deleted=0")
    )
    # Historical snapshots remain fully checked above even when their source
    # sheets no longer exist. Recalculate only real source scopes.
    from server_app.composition import read_occupancies_for_billing

    months = {month for month, _, _ in groups}
    months.update(row[0] for row in conn.execute("SELECT DISTINCT month FROM billing_workflows"))
    months.update(row[0][:7] for row in conn.execute("SELECT start_date FROM occupancies") if row[0])
    for month in sorted(months):
        for occupancy in read_occupancies_for_billing(conn, month):
            if occupancy.get("pi"):
                groups.add((month, occupancy["pi"], "cage_map"))
    actor = {
        "id": "database-review",
        "username": "database-review",
        "displayName": "数据库副本核查",
        "role": "admin",
        "roomIds": [],
    }
    result = {}
    with patch.object(generation, "now_iso", return_value="2000-01-01T00:00:00+00:00"):
        for month, pi, source in sorted(groups):
            statement, lines, *_ = generate_billing_statement_by_pi(
                conn, {"month": month, "pi": pi, "sourceType": source, "persist": False}, actor
            )
            result[digest((month, pi, source))] = digest(clean_calculation(statement, lines))
    return result
