#!/usr/bin/env python3
import json
import sqlite3
from http import HTTPStatus
from urllib.parse import parse_qs, unquote, urlparse

try:
    import openpyxl
except ImportError:
    openpyxl = None


from server_app.cache import (
    invalidate_data_cache,
    invalidate_data_cache_prefixes,
)
from server_app.config import (
    SESSION_COOKIE,
)
from server_app.db import connect_db
from server_app.domains.administration import (
    user_from_token,
)
from server_app.domains.iacuc.sync import (
    invalidate_quantity_sheet_candidate_snapshots,
    invalidate_quantity_sheet_candidate_snapshots_by_pi,
    save_principal_identity,
)
from server_app.domains.state.infrastructure_commands import (
    write_infrastructure as write_infrastructure_state,
)
from server_app.domains.state.query import (
    filter_entity_payloads_for_actor,
)
from server_app.repositories.entities import (
    list_audit_events_page,
    list_intake_batches_page,
    list_placement_tasks_page,
)
from server_app.repositories.filter_options import filtered_where
from server_app.shared import clean_text
from server_app.shared.concurrency import StaleWriteError
from server_app.web import route_matchers
from server_app.web.entity_contracts import ENTITY_ORDER_BY, WRITABLE_ENTITY_ENDPOINTS
from server_app.web.pdf_exports import (
    invalidate_all_pdf_cache,
    invalidate_pdf_cache_for_sheets,
    schedule_pdf_cache_refresh,
)
from server_app.web.ports import app_ports


class HandlerSupportMixin:
    def current_user(self):
        with connect_db() as conn:
            return user_from_token(conn, self.session_token())

    def require_user(self):
        user = self.current_user()
        if not user:
            self.send_json({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
            return None
        return user

    def session_token(self):
        cookie = self.headers.get("Cookie", "")
        for part in cookie.split(";"):
            if "=" not in part:
                continue
            key, value = part.strip().split("=", 1)
            if key == SESSION_COOKIE:
                return value
        return ""

    def list_filters(self, default_limit=10000, max_limit=10000):
        query = parse_qs(urlparse(self.path).query)

        def value(key):
            return query.get(key, [""])[0]

        column_filters = {}
        raw_column_filters = value("columnFilters") or value("filters")
        if raw_column_filters:
            try:
                parsed = json.loads(raw_column_filters)
            except json.JSONDecodeError:
                parsed = {}
            if isinstance(parsed, dict):
                for key, values in parsed.items():
                    if isinstance(values, list):
                        cleaned = [clean_text(item) for item in values if clean_text(item)]
                    else:
                        cleaned = [clean_text(values)] if clean_text(values) else []
                    if cleaned:
                        column_filters[clean_text(key)] = cleaned
        return {
            "limit": app_ports().bounded_int(value("limit"), default_limit, 1, max_limit),
            "offset": app_ports().bounded_int(value("offset"), 0, 0, 1_000_000),
            "sortKey": value("sortKey"),
            "sortDir": value("sortDir"),
            "columnFilters": column_filters,
            "status": value("status"),
            "month": value("month"),
            "iacuc": value("iacuc"),
            "pi": value("pi"),
            "sourcePi": value("sourcePi"),
            "fundingOwner": value("fundingOwner"),
            "keyword": value("keyword"),
            "roomId": value("roomId"),
            "roomName": value("roomName"),
            "sourceType": value("sourceType"),
            "entityType": value("entityType"),
            "action": value("action"),
            "onlyUnpaid": value("onlyUnpaid"),
        }

    def send_entity_list(self, table, actor):
        with connect_db() as conn:
            if table == "audit_events":
                filters = self.list_filters(default_limit=500, max_limit=1000)
                payload = list_audit_events_page(conn, filters, filtered_where)
                items = payload["items"]
                page = payload["page"]
            elif table == "intake_batches":
                filters = self.list_filters()
                payload = list_intake_batches_page(conn, filters, filtered_where, ENTITY_ORDER_BY)
                items = payload["items"]
                page = payload["page"]
            elif table == "placement_tasks":
                filters = self.list_filters()
                if actor.get("role") != "admin":
                    allowed_rooms = [clean_text(item) for item in actor.get("roomIds", []) if clean_text(item)]
                    requested_room_id = clean_text(filters.get("roomId", ""))
                    if requested_room_id and requested_room_id not in allowed_rooms:
                        filters["roomIds"] = []
                        filters["roomId"] = ""
                    elif not requested_room_id:
                        filters["roomIds"] = allowed_rooms
                payload = list_placement_tasks_page(conn, filters, ENTITY_ORDER_BY, clean_text)
                items = payload["items"]
                page = payload["page"]
            else:
                rows = conn.execute(
                    f"SELECT payload FROM {table} ORDER BY {ENTITY_ORDER_BY.get(table, 'rowid')}"
                ).fetchall()
                items = [json.loads(row["payload"]) for row in rows]
                page = None
        collection = {
            "rooms": "rooms",
            "racks": "racks",
            "cage_slots": "slots",
            "occupancies": "occupancies",
            "placement_tasks": "placementTasks",
        }.get(table)
        if collection:
            items = filter_entity_payloads_for_actor(collection, items, actor)
        response = {"items": items}
        if page:
            response["page"] = page
        self.send_json(response)

    def entity_route(self, path):
        for endpoint in WRITABLE_ENTITY_ENDPOINTS:
            prefix = endpoint + "/"
            if path.startswith(prefix):
                item_id = unquote(path[len(prefix) :])
                if "/" not in item_id and item_id:
                    return endpoint, item_id
        return None, None

    def animal_inspection_route(self, path):
        return route_matchers.animal_inspection_route(path)

    def reimbursement_claim_route(self, path):
        return route_matchers.reimbursement_claim_route(path)

    def reimbursement_obligation_route(self, path):
        return route_matchers.reimbursement_obligation_route(path)

    def reimbursement_attachment_route(self, path):
        return route_matchers.reimbursement_attachment_route(path)

    def reimbursement_claim_attachment_upload_route(self, path):
        return route_matchers.reimbursement_claim_attachment_upload_route(path)

    def billing_workflow_attachment_upload_route(self, path):
        return route_matchers.billing_workflow_attachment_upload_route(path)

    def billing_workflow_reimbursement_recording_route(self, path):
        return route_matchers.billing_workflow_reimbursement_recording_route(path)

    def billing_workflow_attachment_download_route(self, path):
        return route_matchers.billing_workflow_attachment_download_route(path)

    def reimbursement_claim_allocation_route(self, path):
        return route_matchers.reimbursement_claim_allocation_route(path)

    def reimbursement_allocation_action_route(self, path, action):
        return route_matchers.reimbursement_allocation_action_route(path, action)

    def reimbursement_legacy_migration_route(self, path):
        return route_matchers.reimbursement_legacy_migration_route(path)

    def animal_inspection_submit_route(self, path):
        return route_matchers.animal_inspection_submit_route(path)

    def animal_inspection_pdf_route(self, path):
        return route_matchers.animal_inspection_pdf_route(path)

    def animal_inspection_attachment_upload_route(self, path):
        query = parse_qs(urlparse(self.path).query)
        finding_id = clean_text(query.get("findingId", [""])[0])
        return route_matchers.animal_inspection_attachment_upload_route(path, finding_id)

    def animal_inspection_attachment_route(self, path):
        return route_matchers.animal_inspection_attachment_route(path)

    def animal_inspection_reference_route(self, path):
        return route_matchers.animal_inspection_reference_route(path)

    def catalog_version_restore_route(self, path):
        return route_matchers.catalog_version_restore_route(path)

    def animal_inspection_finding_action_route(self, path, action):
        return route_matchers.animal_inspection_finding_action_route(path, action)

    def animal_inspection_filters(self):
        query = parse_qs(urlparse(self.path).query)
        return {
            "limit": clean_text(query.get("limit", ["20"])[0]) or "20",
            "offset": clean_text(query.get("offset", ["0"])[0]) or "0",
            "sortKey": clean_text(query.get("sortKey", [""])[0]),
            "sortDir": clean_text(query.get("sortDir", [""])[0]),
            "room": clean_text(query.get("room", [""])[0]),
            "status": clean_text(query.get("status", [""])[0]),
            "module": clean_text(query.get("module", [""])[0]),
            "creator": clean_text(query.get("creator", [""])[0]),
            "severity": clean_text(query.get("severity", [""])[0]),
            "dateFrom": clean_text(query.get("dateFrom", [""])[0]),
            "dateTo": clean_text(query.get("dateTo", [""])[0]),
        }
        return None, None

    def user_route(self, path):
        return route_matchers.user_route(path)

    def quantity_sheet_route(self, path):
        return route_matchers.quantity_sheet_route(path)

    def billing_statement_route(self, path):
        return route_matchers.billing_statement_route(path)

    def principal_identity_route(self, path):
        return route_matchers.principal_identity_route(path)

    def billing_workflow_route(self, path):
        return route_matchers.billing_workflow_route(path)

    def billing_workflow_lines_route(self, path):
        return route_matchers.billing_workflow_lines_route(path)

    def reimbursement_record_route(self, path):
        return route_matchers.reimbursement_record_route(path)

    def intake_batch_confirm_route(self, path):
        return route_matchers.intake_batch_confirm_route(path)

    def placement_task_action_route(self, path, action):
        return route_matchers.placement_task_action_route(path, action)

    def quantity_sheet_generate_route(self, path):
        return route_matchers.quantity_sheet_generate_route(path)

    def handle_entity_write(self, method, endpoint, item_id):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_optional_json_body() if method == "DELETE" else self.read_json_body()
            payload, status = app_ports().write_entity_state(endpoint, method, item_id, body, user)
            self.send_json(payload, status)
        except StaleWriteError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.CONFLICT)
        except sqlite3.IntegrityError:
            self.send_json({"error": "实体 id 已存在"}, HTTPStatus.CONFLICT)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_infrastructure_write(self):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            payload = write_infrastructure_state(body, user)
            self.send_json(payload, HTTPStatus.CREATED)
        except sqlite3.IntegrityError:
            self.send_json({"error": "实体 id 已存在"}, HTTPStatus.CONFLICT)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_quantity_sheet_save(self, sheet_id):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            with connect_db() as conn:
                sheet, previous_sheet, affected_sheets, audit_logs, status, perf = app_ports().save_quantity_sheet(
                    conn, body, user, sheet_id
                )
                invalidate_quantity_sheet_candidate_snapshots(
                    conn, [item for item in (previous_sheet, sheet, *affected_sheets) if item]
                )
                conn.commit()
            invalidate_data_cache("principal_identities")
            invalidate_data_cache_prefixes("quantity_sheets::", "billing_workflows::")
            changed_sheets = [item for item in (previous_sheet, sheet, *affected_sheets) if item]
            invalidate_pdf_cache_for_sheets(changed_sheets)
            schedule_pdf_cache_refresh(
                [sheet, *affected_sheets],
                connect_db=connect_db,
                generate_statement=app_ports().generate_billing_statement_by_pi,
                billing_scopes={(item.get("month", ""), item.get("pi", "")) for item in changed_sheets},
            )
            self.send_json(
                {"item": sheet, "affectedItems": affected_sheets, "auditLogs": audit_logs, "perf": perf}, status
            )
        except StaleWriteError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.CONFLICT)
        except sqlite3.IntegrityError:
            self.send_json({"error": "数量统计表 id 已存在"}, HTTPStatus.CONFLICT)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_principal_identity_save(self, pi_name):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            body = self.read_json_body()
            with connect_db() as conn:
                item, audit_logs = save_principal_identity(conn, body, user, pi_name)
                invalidate_quantity_sheet_candidate_snapshots_by_pi(conn, pi_name)
                conn.commit()
            invalidate_all_pdf_cache()
            self.send_json({"item": item, "auditLogs": audit_logs})
        except StaleWriteError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.CONFLICT)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_quantity_sheet_print_data(self):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            with connect_db() as conn:
                self.send_json({"items": app_ports().quantity_sheet_print_items(conn, body, user)})
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_quantity_sheet_delete(self, sheet_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                sheet, audit_logs = app_ports().delete_quantity_sheet(conn, user, sheet_id)
                invalidate_quantity_sheet_candidate_snapshots(conn, [sheet])
                conn.commit()
            invalidate_data_cache("principal_identities")
            invalidate_data_cache_prefixes("quantity_sheets::", "billing_workflows::")
            invalidate_pdf_cache_for_sheets([sheet])
            schedule_pdf_cache_refresh(
                [],
                connect_db=connect_db,
                generate_statement=app_ports().generate_billing_statement_by_pi,
                billing_scopes={(sheet.get("month", ""), sheet.get("pi", ""))},
            )
            self.send_json({"ok": True, "auditLogs": audit_logs})
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)

    def handle_quantity_sheet_statement_generate(self, sheet_id):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_optional_json_body()
            with connect_db() as conn:
                statement, lines, audit_logs = app_ports().generate_quantity_sheet_statement(conn, sheet_id, body, user)
                conn.commit()
            self.send_json({"statement": statement, "lines": lines, "auditLogs": audit_logs}, HTTPStatus.CREATED)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_intake_batch_confirm(self, batch_id):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            self.send_json(app_ports().persist_intake_receipt_confirmation(batch_id, body, user), HTTPStatus.CREATED)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_intake_batches_mark_printed(self):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            self.send_json(app_ports().persist_intake_batches_mark_printed(body, user))
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_intake_batches_confirm_receipt(self):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            self.send_json(app_ports().persist_intake_receipt_confirmations(body, user), HTTPStatus.CREATED)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_placement_task_reserve(self, task_id):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            self.send_json(
                app_ports().persist_placement_action(
                    task_id,
                    user,
                    lambda state: app_ports().reserve_placement_task(
                        state, task_id, clean_text(body.get("slotId")), user
                    ),
                )
            )
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_placement_task_move_in(self, task_id):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            self.send_json(
                app_ports().persist_placement_action(
                    task_id,
                    user,
                    lambda state: app_ports().move_in_placement_task(
                        state, task_id, body.get("actualMoveInDate"), user
                    ),
                )
            )
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_placement_task_reassign_room(self, task_id):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            self.send_json(
                app_ports().persist_placement_action(
                    task_id,
                    user,
                    lambda state: app_ports().reassign_placement_task_room(
                        state, task_id, clean_text(body.get("roomId")), user
                    ),
                )
            )
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
