"""Domain-specific GET adapters; connection and permission boundaries unchanged."""

import mimetypes
from http import HTTPStatus

from server_app.config import ANIMAL_INSPECTION_CATALOG_PATH, ANIMAL_INSPECTION_IMAGES_PATH
from server_app.db import connect_db
from server_app.domains.animal_management import export_inspection_pdf
from server_app.domains.animal_management import get_attachment as get_animal_inspection_attachment
from server_app.domains.animal_management import get_inspection as get_animal_inspection


class ReadInspectionActionsMixin:
    def get_animal_inspection_attachment(self, path, attachment_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                attachment, body = get_animal_inspection_attachment(conn, user, attachment_id)
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
        return

    def get_animal_inspection_reference(self, path, reference_name):
        if not self.require_user():
            return
        target = (ANIMAL_INSPECTION_IMAGES_PATH / reference_name).resolve()
        root = ANIMAL_INSPECTION_IMAGES_PATH.resolve()
        if not target.is_file() or root not in target.parents:
            target = (ANIMAL_INSPECTION_CATALOG_PATH / "images" / reference_name).resolve()
            root = (ANIMAL_INSPECTION_CATALOG_PATH / "images").resolve()
        if not target.is_file() or root not in target.parents:
            self.send_json({"error": "参考图例不存在"}, HTTPStatus.NOT_FOUND)
            return
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, max-age=86400")
        self.end_headers()
        self.wfile.write(body)
        return

    def get_animal_inspection_pdf(self, path, inspection_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                body, filename = export_inspection_pdf(conn, user, inspection_id)
            self.send_download(body, filename, "application/pdf")
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except RuntimeError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.SERVICE_UNAVAILABLE)
        return

    def get_animal_inspection(self, path, inspection_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                self.send_json(get_animal_inspection(conn, user, inspection_id))
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        return
