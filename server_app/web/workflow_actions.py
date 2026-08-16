#!/usr/bin/env python3
import json
from http import HTTPStatus

try:
    import openpyxl
except ImportError:
    openpyxl = None


from server_app.cache import (
    invalidate_data_cache,
    invalidate_data_cache_prefixes,
)
from server_app.config import (
    ANIMAL_INSPECTION_IMAGES_PATH,
    SESSION_COOKIE,
)
from server_app.db import connect_db
from server_app.domains.administration import (
    audit_event,
    authenticate,
    create_session,
    delete_session,
    merge_audit_logs,
    write_audit_events,
)
from server_app.domains.animal_management import (
    catalog_payload as animal_inspection_catalog_payload,
)
from server_app.domains.animal_management.catalog_draft import (
    publish_draft as publish_animal_inspection_catalog_draft,
)
from server_app.domains.animal_management.catalog_draft import (
    restore_catalog_version as restore_animal_inspection_catalog_version,
)
from server_app.domains.animal_management.catalog_draft import (
    save_draft as save_animal_inspection_catalog_draft,
)
from server_app.domains.animal_management.catalog_images import (
    image_size_error,
    save_reference_image,
)
from server_app.domains.billing.candidates import (
    update_settlement_candidate_snapshot_from_statement,
)
from server_app.domains.iacuc import (
    parse_iacuc_csv,
)
from server_app.domains.iacuc.sync import (
    application_payload,
    invalidate_all_quantity_sheet_candidate_snapshots,
    read_current_applications,
    sync_project_derived_fields_after_iacuc_upload,
    write_experiment_applications,
)
from server_app.domains.reimbursement.facade import (
    delete_reimbursement_record,
    get_reimbursement_record_by_workflow_id,
    upsert_reimbursement_record,
)
from server_app.domains.reimbursement.projector import (
    join_distinct_text,
)
from server_app.domains.workflow.application import (
    record_archived_reimbursement,
    update_workflow_status,
)
from server_app.domains.workflow.constants import (
    WORKFLOW_STATUS_LOCKED,
)
from server_app.domains.workflow.facade import (
    delete_billing_workflow,
    get_billing_workflow,
)
from server_app.repositories.reimbursement import (
    reimbursement_record_list_item,
)
from server_app.services.reimbursement import (
    reimbursement_has_manual_entry,
)
from server_app.shared import clean_text, now_iso
from server_app.shared.concurrency import StaleWriteError
from server_app.web.multipart import parse_multipart_upload
from server_app.web.pdf_exports import (
    invalidate_all_pdf_cache,
)
from server_app.web.ports import app_ports


class WorkflowActionsMixin:
    def handle_login(self):
        try:
            body = self.read_json_body()
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        username = str(body.get("username", "")).strip()
        password = str(body.get("password", ""))
        with connect_db() as conn:
            user = authenticate(conn, username, password)
            if not user:
                self.send_json({"error": "用户名或密码错误"}, HTTPStatus.UNAUTHORIZED)
                return
            token, expires_at = create_session(conn, user["id"])
            now = now_iso()
            event = audit_event(
                user,
                "auth.login",
                "session",
                user["id"],
                f"{user['displayName']} 登录系统",
                [],
                now,
                None,
                {
                    "username": user["username"],
                    "role": user["role"],
                    "clientIp": self.client_address[0] if self.client_address else "",
                    "userAgent": self.headers.get("User-Agent", ""),
                },
            )
            write_audit_events(conn, [event])
            conn.commit()
        self.send_response(HTTPStatus.OK)
        body_bytes = json.dumps({"user": user}, ensure_ascii=False).encode("utf-8")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Set-Cookie",
            f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Expires={app_ports().format_http_date(expires_at)}",
        )
        self.end_headers()
        self.wfile.write(body_bytes)

    def handle_logout(self):
        token = self.session_token()
        with connect_db() as conn:
            delete_session(conn, token)
        self.send_response(HTTPStatus.OK)
        body = b'{"ok": true}'
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
        self.end_headers()
        self.wfile.write(body)

    def handle_iacuc_upload(self):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return

        try:
            raw = self.read_raw_body()
            filename, file_body = parse_multipart_upload(self.headers.get("Content-Type", ""), raw)
            if filename and not filename.lower().endswith(".csv"):
                raise ValueError("目前只支持上传 CSV 文件")
            parsed = parse_iacuc_csv(file_body)
            now = now_iso()
            file_items = [application_payload(item, now) for item in parsed["items"]]
            app_ports().save_iacuc_index_file(file_items)
            event = audit_event(
                user,
                "iacuc_index.uploaded",
                "iacuc_index",
                "iacuc-index",
                f"{user['displayName']} 上传 IACUC 索引 {len(parsed['items'])} 条",
                [],
                now,
                None,
                {"filename": filename, **parsed["summary"]},
            )
            with connect_db() as conn:
                old_items = read_current_applications(conn)
                write_experiment_applications(conn, parsed["items"], now)
                sync_summary = sync_project_derived_fields_after_iacuc_upload(conn, old_items, file_items, user, now)
                invalidate_all_quantity_sheet_candidate_snapshots(conn)
                write_audit_events(conn, [event])
                conn.commit()
            invalidate_data_cache("assembled_state", "iacuc_index", "principal_identities", "principal_types_by_pi")
            invalidate_data_cache_prefixes(
                "bootstrap_summary::",
                "billing_occupancies::",
                "quantity_sheets::",
                "billing_workflows::",
                "billing_statements::",
                "reimbursement_records::",
                "intake_batches::",
                "placement_tasks::",
            )
            invalidate_all_pdf_cache()
            self.send_json(
                {
                    "ok": True,
                    "filename": filename,
                    "updatedAt": now,
                    **parsed["summary"],
                    "syncSummary": sync_summary,
                    "items": file_items,
                    "auditLogs": merge_audit_logs([], [event]),
                }
            )
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_animal_inspection_catalog_draft_save(self):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            body = self.read_json_body()
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        try:
            with connect_db() as conn:
                payload = save_animal_inspection_catalog_draft(
                    conn, user, body, image_root=ANIMAL_INSPECTION_IMAGES_PATH
                )
            self.send_json(payload)
        except StaleWriteError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.CONFLICT)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_animal_inspection_catalog_publish(self):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            with connect_db() as conn:
                publish_animal_inspection_catalog_draft(conn, user, image_root=ANIMAL_INSPECTION_IMAGES_PATH)
                payload = animal_inspection_catalog_payload(conn, user)
            self.send_json(payload)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_animal_inspection_catalog_version_restore(self, version):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            with connect_db() as conn:
                restore_animal_inspection_catalog_version(conn, user, version, image_root=ANIMAL_INSPECTION_IMAGES_PATH)
                payload = animal_inspection_catalog_payload(conn, user)
            self.send_json(payload)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_animal_inspection_catalog_image_upload(self):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            raw = self.read_raw_body()
            filename, file_body = parse_multipart_upload(self.headers.get("Content-Type", ""), raw)
            if size_error := image_size_error(file_body):
                raise ValueError(size_error)
            name = save_reference_image(ANIMAL_INSPECTION_IMAGES_PATH, filename, file_body)
            self.send_json(
                {"ok": True, "filename": name, "url": f"/api/animal-inspection-reference/{name}"},
                HTTPStatus.CREATED,
            )
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_billing_statement_generate(self):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        try:
            with connect_db() as conn:
                statement, lines, audit_logs = app_ports().generate_billing_statement(conn, body, user)
                workflow = (
                    get_billing_workflow(conn, statement.get("workflowId", "")) if statement.get("workflowId") else None
                )
                conn.commit()
            self.send_json(
                {"statement": statement, "lines": lines, "workflow": workflow, "auditLogs": audit_logs},
                HTTPStatus.CREATED,
            )
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_billing_statement_generate_by_pi(self):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        try:
            refresh_candidate_cache = clean_text(body.get("sourceType", "cage_map")) == "quantity_sheet"
            with connect_db() as conn:
                statement, lines, audit_logs = app_ports().generate_billing_statement_by_pi(conn, body, user)
                if refresh_candidate_cache:
                    update_settlement_candidate_snapshot_from_statement(
                        conn,
                        clean_text(body.get("month", "")),
                        clean_text(body.get("pi", "")),
                        statement,
                        "quantity_sheet",
                        statement.get("generatedAt", "") or now_iso(),
                    )
                workflow = (
                    get_billing_workflow(conn, statement.get("workflowId", "")) if statement.get("workflowId") else None
                )
                reimbursement = (
                    get_reimbursement_record_by_workflow_id(conn, statement.get("workflowId", ""))
                    if statement.get("workflowId")
                    else None
                )
                conn.commit()
            if refresh_candidate_cache:
                invalidate_data_cache_prefixes("quantity_sheets::settlement_candidates::")
            self.send_json(
                {
                    "statement": statement,
                    "lines": lines,
                    "workflow": workflow,
                    "reimbursementItem": reimbursement_record_list_item(reimbursement) if reimbursement else None,
                    "auditLogs": audit_logs,
                },
                HTTPStatus.CREATED,
            )
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_billing_workflow_advance(self):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            workflow_id = clean_text(body.get("workflowId", ""))
            to_status = clean_text(body.get("toStatus", ""))
            note = clean_text(body.get("note", ""))
            registration = body.get("registration") if isinstance(body.get("registration"), dict) else None
            with connect_db() as conn:
                current = get_billing_workflow(conn, workflow_id)
                if not current:
                    raise LookupError("结算流程不存在")
                is_lock_operation = (
                    to_status == WORKFLOW_STATUS_LOCKED or current.get("workflowStatus") == WORKFLOW_STATUS_LOCKED
                )
                if is_lock_operation:
                    if not user.get("billingLockAllowed"):
                        self.send_json({"error": "需要结算锁定授权"}, HTTPStatus.FORBIDDEN)
                        return
                elif user["role"] != "admin":
                    self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
                    return
                workflow, version, event = update_workflow_status(
                    conn, workflow_id, to_status, user, note, registration
                )
                reimbursement = get_reimbursement_record_by_workflow_id(conn, workflow_id)
                if reimbursement:
                    reimbursement["workflowStatus"] = workflow.get("workflowStatus", "")
                    reimbursement["latestEventAt"] = workflow.get("latestEventAt", "") or event.get("at", "")
                    reimbursement["updatedAt"] = now_iso()
                    upsert_reimbursement_record(conn, reimbursement)
                audit = audit_event(
                    user,
                    f"billing_workflow.{to_status}",
                    "billing_workflow",
                    workflow_id,
                    f"{user['displayName']} 更新 {workflow.get('iacuc', '')} {workflow.get('month', '')} 结算流程状态",
                    [],
                    event["at"],
                    None,
                    {"workflow": workflow, "version": version, "event": event},
                )
                write_audit_events(conn, [audit])
                conn.commit()
            invalidate_data_cache_prefixes(
                "billing_workflows::",
                "billing_statements::",
                "reimbursement_records::",
                "quantity_sheets::settlement_candidates::",
            )
            self.send_json(
                {
                    "workflow": workflow,
                    "event": event,
                    "reimbursementItem": reimbursement_record_list_item(reimbursement) if reimbursement else None,
                    "auditLogs": merge_audit_logs([], [audit]),
                }
            )
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_billing_workflow_reimbursement_recording(self, workflow_id):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        try:
            with connect_db() as conn:
                current = get_billing_workflow(conn, workflow_id)
                if not current:
                    raise LookupError("结算流程不存在")
                if current.get("workflowStatus") == WORKFLOW_STATUS_LOCKED:
                    if not user.get("billingLockAllowed"):
                        self.send_json({"error": "已锁定流程补录需要结算锁定授权"}, HTTPStatus.FORBIDDEN)
                        return
                elif user["role"] != "admin":
                    self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
                    return
                workflow, version, event = record_archived_reimbursement(
                    conn,
                    workflow_id,
                    body.get("reimbursementForms") if isinstance(body.get("reimbursementForms"), list) else [],
                    user,
                    clean_text(body.get("note", "")),
                )
                reimbursement = get_reimbursement_record_by_workflow_id(conn, workflow_id)
                if reimbursement:
                    reimbursement["workflowStatus"] = workflow.get("workflowStatus", "")
                    reimbursement["latestEventAt"] = workflow.get("latestEventAt", "") or event.get("at", "")
                    reimbursement["updatedAt"] = now_iso()
                    upsert_reimbursement_record(conn, reimbursement)
                audit = audit_event(
                    user,
                    "billing_workflow.reimbursement_recorded",
                    "billing_workflow",
                    workflow_id,
                    f"{user['displayName']} 为 {workflow.get('iacuc', '')} {workflow.get('month', '')} 结算流程补录报销单",
                    [],
                    event["at"],
                    None,
                    {"workflow": workflow, "version": version, "event": event},
                )
                write_audit_events(conn, [audit])
                conn.commit()
            invalidate_data_cache_prefixes(
                "billing_workflows::",
                "billing_statements::",
                "reimbursement_records::",
                "quantity_sheets::settlement_candidates::",
            )
            self.send_json(
                {
                    "workflow": workflow,
                    "event": event,
                    "reimbursementItem": reimbursement_record_list_item(reimbursement) if reimbursement else None,
                    "auditLogs": merge_audit_logs([], [audit]),
                }
            )
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_billing_workflow_delete(self, workflow_id):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            with connect_db() as conn:
                existing = get_billing_workflow(conn, workflow_id)
                if existing and existing.get("workflowStatus") == WORKFLOW_STATUS_LOCKED:
                    raise ValueError("已锁定流程不允许撤销，请先解锁")
                workflow = delete_billing_workflow(conn, workflow_id)
                reimbursement = get_reimbursement_record_by_workflow_id(conn, workflow_id)
                deleted_reimbursement_id = ""
                if reimbursement:
                    if reimbursement_has_manual_entry(reimbursement) or reimbursement.get("source") == "imported":
                        reimbursement["workflowId"] = ""
                        reimbursement["workflowStatus"] = "workflow_deleted"
                        reimbursement["notes"] = join_distinct_text(reimbursement.get("notes", ""), "原流程已删除")
                        reimbursement["latestEventAt"] = now_iso()
                        reimbursement["updatedAt"] = now_iso()
                        upsert_reimbursement_record(conn, reimbursement)
                    else:
                        deleted_reimbursement_id = reimbursement.get("id", "")
                        delete_reimbursement_record(conn, reimbursement["id"])
                at = now_iso()
                audit = audit_event(
                    user,
                    "billing_workflow.deleted",
                    "billing_workflow",
                    workflow_id,
                    f"{user['displayName']} 删除 {workflow.get('pi') or workflow.get('iacuc', '')} {workflow.get('month', '')} 结算流程",
                    [],
                    at,
                    workflow,
                    None,
                )
                write_audit_events(conn, [audit])
                conn.commit()
            invalidate_data_cache_prefixes(
                "billing_workflows::",
                "billing_statements::",
                "reimbursement_records::",
                "quantity_sheets::settlement_candidates::",
            )
            self.send_json(
                {
                    "ok": True,
                    "workflow": workflow,
                    "reimbursementItem": reimbursement_record_list_item(reimbursement)
                    if reimbursement and not deleted_reimbursement_id
                    else None,
                    "deletedReimbursementId": deleted_reimbursement_id,
                    "auditLogs": merge_audit_logs([], [audit]),
                }
            )
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
