"""Domain-specific GET adapters; connection and permission boundaries unchanged."""

from http import HTTPStatus
from urllib.parse import parse_qs, urlparse

from server_app.db import connect_db
from server_app.domains.administration import (
    list_performance_history,
    list_users,
    system_environment,
    system_update_status,
)
from server_app.web.pdf_exports import download_pdf_export_job, read_pdf_export_job
from server_app.web.ports import app_ports


class ReadSystemActionsMixin:
    def get_pdf_export_job(self, path, pdf_job_id, pdf_job_download):
        (download_pdf_export_job if pdf_job_download else read_pdf_export_job)(self, pdf_job_id)
        return

    def get_iacuc_index_status(self, path):
        if not self.require_user():
            return
        payload = app_ports().read_iacuc_index()
        self.send_json({key: payload[key] for key in ("count", "updatedAt", "source")})
        return

    def get_system_update_check(self, path):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            self.send_json(system_update_status())
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_GATEWAY)
        return

    def get_system_environment(self, path):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        self.send_json(system_environment())
        return

    def get_system_performance_history(self, path):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        hours = parse_qs(urlparse(self.path).query).get("hours", ["24"])[0]
        try:
            self.send_json(list_performance_history(hours))
        except ValueError:
            self.send_json({"error": "hours 必须是整数"}, HTTPStatus.BAD_REQUEST)
        return

    def get_users(self, path):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        with connect_db() as conn:
            self.send_json({"users": list_users(conn)})
        return
