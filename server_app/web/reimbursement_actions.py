#!/usr/bin/env python3
import sqlite3
from http import HTTPStatus
from urllib.parse import parse_qs, urlparse

try:
    import openpyxl
except ImportError:
    openpyxl = None


from server_app.cache import (
    invalidate_data_cache_prefixes,
)
from server_app.db import connect_db
from server_app.domains.administration import (
    audit_event,
    merge_audit_logs,
    write_audit_events,
)
from server_app.domains.animal_management import (
    add_attachment as add_animal_inspection_attachment,
)
from server_app.domains.reimbursement.application import (
    import_arrears_reimbursement_workbook,
    import_monthly_reimbursement_workbook,
    recalculate_reimbursement_accumulations,
    reimbursement_detail_payload,
)
from server_app.domains.reimbursement.facade import (
    delete_reimbursement_record,
    get_reimbursement_record,
    upsert_reimbursement_record,
)
from server_app.domains.reimbursement_ledger import (
    add_attachment as add_reimbursement_attachment,
)
from server_app.domains.reimbursement_ledger import (
    confirm_allocation as confirm_reimbursement_allocation,
)
from server_app.domains.reimbursement_ledger import (
    create_allocation as create_reimbursement_allocation,
)
from server_app.domains.reimbursement_ledger import (
    delete_claim as delete_reimbursement_claim,
)
from server_app.domains.reimbursement_ledger import (
    migrate_legacy_record as migrate_reimbursement_legacy_record,
)
from server_app.domains.reimbursement_ledger import (
    reverse_allocation as reverse_reimbursement_allocation,
)
from server_app.domains.reimbursement_ledger import (
    save_claim as save_reimbursement_claim,
)
from server_app.domains.workflow.application import (
    add_billing_workflow_attachment,
    get_billing_workflow_attachment,
)
from server_app.services.reimbursement import (
    merge_reimbursement_edit,
)
from server_app.shared import clean_text, now_iso
from server_app.shared.concurrency import StaleWriteError, require_current_version
from server_app.web import animal_inspection as animal_inspection_web
from server_app.web.multipart import parse_multipart_upload


class ReimbursementActionsMixin:
    def handle_reimbursement_monthly_import(self):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            raw = self.read_raw_body()
            filename, file_body = parse_multipart_upload(self.headers.get("Content-Type", ""), raw)
            if filename and not filename.lower().endswith(".xlsx"):
                raise ValueError("请上传月汇总 Excel 文件")
            with connect_db() as conn:
                payload = import_monthly_reimbursement_workbook(conn, file_body, user)
                conn.commit()
            self.send_json({**payload, "filename": filename}, HTTPStatus.CREATED)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_reimbursement_arrears_import(self):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            raw = self.read_raw_body()
            filename, file_body = parse_multipart_upload(self.headers.get("Content-Type", ""), raw)
            if filename and not filename.lower().endswith(".xlsx"):
                raise ValueError("请上传欠缴汇算 Excel 文件")
            with connect_db() as conn:
                payload = import_arrears_reimbursement_workbook(conn, file_body, user)
                conn.commit()
            self.send_json({**payload, "filename": filename}, HTTPStatus.CREATED)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_reimbursement_record_update(self, record_id):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            patch = self.read_json_body()
            with connect_db() as conn:
                existing = get_reimbursement_record(conn, record_id)
                if not existing:
                    raise LookupError("报销台账不存在")
                require_current_version(existing, patch.get("expectedUpdatedAt"), "报销台账")
                updated = merge_reimbursement_edit(existing, patch)
                updated["latestEventAt"] = now_iso()
                updated["updatedAt"] = now_iso()
                upsert_reimbursement_record(conn, updated)
                recalculate_reimbursement_accumulations(conn, updated.get("pi", ""))
                refreshed = get_reimbursement_record(conn, record_id) or updated
                audit = audit_event(
                    user,
                    "reimbursement.updated",
                    "reimbursement_record",
                    record_id,
                    f"{user['displayName']} 更新 {refreshed.get('pi', '')} {refreshed.get('month', '')} 报销台账",
                    [],
                    refreshed.get("updatedAt", now_iso()),
                    existing,
                    refreshed,
                )
                write_audit_events(conn, [audit])
                conn.commit()
            invalidate_data_cache_prefixes("reimbursement_records::")
            with connect_db() as conn:
                detail = reimbursement_detail_payload(conn, get_reimbursement_record(conn, record_id) or refreshed)
            self.send_json({**detail, "auditLogs": merge_audit_logs([], [audit])})
        except StaleWriteError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.CONFLICT)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_reimbursement_record_delete(self, record_id):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            with connect_db() as conn:
                record = get_reimbursement_record(conn, record_id)
                if not record:
                    raise LookupError("报销台账不存在")
                pi_name = record.get("pi", "")
                delete_reimbursement_record(conn, record_id)
                recalculate_reimbursement_accumulations(conn, pi_name)
                audit = audit_event(
                    user,
                    "reimbursement.deleted",
                    "reimbursement_record",
                    record_id,
                    f"{user['displayName']} 删除 {record.get('pi', '')} {record.get('month', '')} 报销台账",
                    [],
                    now_iso(),
                    record,
                    None,
                )
                write_audit_events(conn, [audit])
                conn.commit()
            invalidate_data_cache_prefixes("reimbursement_records::")
            self.send_json({"ok": True, "item": record, "auditLogs": merge_audit_logs([], [audit])})
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)

    def handle_animal_inspection_save(self, inspection_id):
        animal_inspection_web.save_inspection(self, inspection_id)

    def handle_reimbursement_claim_save(self, claim_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                payload = save_reimbursement_claim(conn, user, claim_id, self.read_json_body())
            self.send_json(payload, HTTPStatus.OK if claim_id else HTTPStatus.CREATED)
        except sqlite3.IntegrityError:
            self.send_json({"error": "报销单号已存在"}, HTTPStatus.CONFLICT)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_reimbursement_claim_delete(self, claim_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                payload = delete_reimbursement_claim(conn, user, claim_id)
            self.send_json(payload)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_billing_workflow_attachment_upload(self, workflow_id):
        user = self.require_user()
        if not user:
            return
        try:
            filename, body = parse_multipart_upload(self.headers.get("Content-Type", ""), self.read_raw_body())
            query = parse_qs(urlparse(self.path).query)
            kind = clean_text(query.get("kind", [""])[0])
            with connect_db() as conn:
                payload = add_billing_workflow_attachment(
                    conn, user, workflow_id, kind, filename, body, self.headers.get("Content-Type", "")
                )
            self.send_json(payload, HTTPStatus.CREATED)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_billing_workflow_attachment_download(self, attachment_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                attachment, body = get_billing_workflow_attachment(conn, user, attachment_id)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", attachment["mimeType"])
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "private, no-store")
            self.end_headers()
            self.wfile.write(body)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)

    def handle_reimbursement_claim_attachment(self, claim_id):
        user = self.require_user()
        if not user:
            return
        try:
            filename, body = parse_multipart_upload(self.headers.get("Content-Type", ""), self.read_raw_body())
            with connect_db() as conn:
                payload = add_reimbursement_attachment(
                    conn, user, claim_id, filename, body, self.headers.get("Content-Type", "")
                )
            self.send_json(payload, HTTPStatus.CREATED)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_reimbursement_allocation_create(self, claim_id):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            body["claimId"] = claim_id
            with connect_db() as conn:
                payload = create_reimbursement_allocation(conn, user, body)
            self.send_json(payload, HTTPStatus.CREATED)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_reimbursement_allocation_confirm(self, allocation_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                self.send_json(confirm_reimbursement_allocation(conn, user, allocation_id))
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_reimbursement_allocation_reverse(self, allocation_id):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            with connect_db() as conn:
                self.send_json(reverse_reimbursement_allocation(conn, user, allocation_id, body.get("reason", "")))
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_reimbursement_legacy_migration(self, record_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                self.send_json(migrate_reimbursement_legacy_record(conn, user, record_id))
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_animal_inspection_submit(self, inspection_id):
        animal_inspection_web.submit_inspection_record(self, inspection_id)

    def handle_animal_inspection_attachment(self, inspection_id, finding_id):
        user = self.require_user()
        if not user:
            return
        try:
            filename, body = parse_multipart_upload(self.headers.get("Content-Type", ""), self.read_raw_body())
            with connect_db() as conn:
                payload = add_animal_inspection_attachment(
                    conn, user, inspection_id, finding_id, filename, body, self.headers.get("Content-Type", "")
                )
            self.send_json(payload, HTTPStatus.CREATED)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_animal_inspection_finding_update(self, finding_id):
        animal_inspection_web.update_finding_record(self, finding_id)

    def handle_animal_inspection_finding_recheck(self, finding_id):
        animal_inspection_web.update_finding_record(self, finding_id, recheck=True)

    def handle_animal_inspection_finding_resolve(self, finding_id):
        animal_inspection_web.update_finding_record(self, finding_id, resolve=True)
