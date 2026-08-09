from http import HTTPStatus
from urllib.parse import parse_qs, urlparse

from server_app.config import ANIMAL_INSPECTION_IMAGES_PATH
from server_app.db import connect_db
from server_app.domains.animal_management import (
    catalog_payload,
    create_or_update_inspection,
    list_findings,
    list_inspections,
    resolve_finding,
    submit_inspection,
    update_finding,
)
from server_app.domains.animal_management.catalog_draft import get_draft, list_catalog_versions
from server_app.shared import clean_text


def handle_get(handler, path):
    if path == "/api/animal-inspection-catalog":
        user = handler.require_user()
        if not user:
            return True
        with connect_db() as conn:
            handler.send_json(catalog_payload(conn, user))
        return True
    if path in {"/api/animal-inspection-catalog/draft", "/api/animal-inspection-catalog/versions"}:
        user = handler.require_user()
        if not user:
            return True
        if user["role"] != "admin":
            handler.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return True
        with connect_db() as conn:
            payload = (
                get_draft(conn, image_root=ANIMAL_INSPECTION_IMAGES_PATH)
                if path.endswith("/draft")
                else list_catalog_versions(conn)
            )
            handler.send_json(payload)
        return True
    if path in {"/api/animal-inspections", "/api/animal-inspection-findings"}:
        user = handler.require_user()
        if not user:
            return True
        with connect_db() as conn:
            operation = list_inspections if path.endswith("inspections") else list_findings
            handler.send_json(operation(conn, user, _filters(handler.path)))
        return True
    return False


def _filters(request_url):
    query = parse_qs(urlparse(request_url).query)
    return {
        key: clean_text(query.get(key, [default])[0]) or default
        for key, default in {
            "limit": "20",
            "offset": "0",
            "sortKey": "",
            "sortDir": "",
            "room": "",
            "status": "",
            "module": "",
            "creator": "",
            "severity": "",
            "dateFrom": "",
            "dateTo": "",
        }.items()
    }


def save_inspection(handler, inspection_id):
    user = handler.require_user()
    if not user:
        return
    try:
        with connect_db() as conn:
            payload = create_or_update_inspection(conn, user, inspection_id, handler.read_json_body())
        handler.send_json(payload, HTTPStatus.OK if inspection_id else HTTPStatus.CREATED)
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)


def submit_inspection_record(handler, inspection_id):
    _write(handler, lambda conn, user: submit_inspection(conn, user, inspection_id))


def update_finding_record(handler, finding_id, *, recheck=False, resolve=False):
    def operation(conn, user):
        body = handler.read_json_body()
        if recheck:
            body["status"] = "pending_recheck"
        return (
            resolve_finding(conn, user, finding_id, body) if resolve else update_finding(conn, user, finding_id, body)
        )

    _write(handler, operation)


def _write(handler, operation):
    user = handler.require_user()
    if not user:
        return
    try:
        with connect_db() as conn:
            handler.send_json(operation(conn, user))
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
