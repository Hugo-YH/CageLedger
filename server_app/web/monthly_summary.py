from collections import defaultdict
from http import HTTPStatus

from server_app.domains.billing.frozen import frozen_statement
from server_app.domains.billing.monthly_summary import (
    EXCEL_CONTENT_TYPE,
    MONTH_PATTERN,
    build_monthly_summary_rows,
    build_monthly_summary_xlsx,
    build_pi_reimbursement_context,
    monthly_summary_filename,
)
from server_app.domains.technical_services.settlement import export_sheets
from server_app.domains.technical_services.summary import merge_service_rows
from server_app.http import send_download


def export_monthly_billing_summary(
    handler,
    *,
    connect_db,
    list_quantity_sheets_by_month,
    list_billing_workflows_by_month,
    read_rooms_for_quantity_sheets,
    read_principal_type_by_pi,
    read_applications_by_iacuc,
    audit_event,
    write_audit_events,
    now_iso,
    clean_text,
):
    user = handler.require_user()
    if not user:
        return
    if user["role"] != "admin":
        handler.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
        return
    try:
        payload = handler.read_json_body()
        month = clean_text(payload.get("month", ""))
        if not MONTH_PATTERN.fullmatch(month):
            raise ValueError("结算月份格式应为 YYYY-MM")
        with connect_db() as conn:
            sheets = list_quantity_sheets_by_month(conn, month)
            service_sheets = export_sheets(conn, month)
            if not sheets and not service_sheets:
                raise ValueError("该月份没有已保存的计费明细")
            reimbursement_by_pi = {}
            workflows_by_pi = defaultdict(list)
            for workflow in list_billing_workflows_by_month(conn, month):
                pi_name = clean_text(workflow.get("pi", ""))
                if pi_name:
                    workflows_by_pi[pi_name].append(workflow)
            for pi_name in {
                clean_text(item.get("pi", "")) for item in [*sheets, *service_sheets] if clean_text(item.get("pi", ""))
            }:
                reimbursement_by_pi[pi_name] = build_pi_reimbursement_context(workflows_by_pi.get(pi_name, []))
            rows = build_monthly_summary_rows(
                month,
                sheets,
                read_rooms_for_quantity_sheets(conn, sheets),
                read_applications_by_iacuc(conn),
                read_principal_type_by_pi(conn),
                reimbursement_by_pi,
                frozen_lines_by_pi={
                    pi: frozen[1]
                    for pi in {s["pi"] for s in sheets}
                    if (frozen := frozen_statement(conn, month, pi, "pi_merged_quantity_sheet"))
                },
            )
            rows = merge_service_rows(rows, service_sheets, read_applications_by_iacuc(conn), reimbursement_by_pi)
            body = build_monthly_summary_xlsx(month, rows)
            at = now_iso()
            audit = audit_event(
                user,
                "billing.monthly_summary.exported",
                "billing_monthly_summary",
                month,
                f"{user['displayName']} 导出 {month} 月度饲养费汇总",
                [],
                at,
                None,
                {
                    "month": month,
                    "rowCount": len(rows),
                    "amount": round(sum(item["amount"] for item in rows), 2),
                    "supportAmount": round(sum(item["supportAmount"] for item in rows), 2),
                    "payableAmount": round(sum(item["payableAmount"] for item in rows), 2),
                    "technicalServiceAmount": round(sum(item["technicalServiceAmount"] for item in rows), 2),
                },
            )
            write_audit_events(conn, [audit])
            conn.commit()
        send_download(handler, body, monthly_summary_filename(month), EXCEL_CONTENT_TYPE)
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
