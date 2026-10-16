"""Bind domain declarations without moving validation or transactions out of their handlers."""

from urllib.parse import unquote

from server_app.repositories.filter_options import route_column_filter_options
from server_app.web import (
    animal_inspection,
    data_quality,
    feedback,
    intake_summary,
    quarantine,
    settlement_candidates,
    system_features,
    technical_services,
)
from server_app.web.pdf_exports import pdf_export_job_route, quantity_sheet_pdf_route
from server_app.web.route_specs import ROUTE_GROUPS
from server_app.web.router import HANDLED

DELEGATES = {
    "system_features": system_features.handle,
    "data_quality": data_quality.handle,
    "settlement_candidates": settlement_candidates.handle,
    "technical_services": technical_services.handle,
    "feedback": feedback.handle,
    "quarantine": quarantine.handle,
    "intake_summary": intake_summary.handle,
    "animal_inspection": animal_inspection.handle_get,
    "filter_options": route_column_filter_options,
}


def _matcher(spec):
    def match(handler, path):
        if name := spec.get("matcher"):
            if name == "pdf_export_job_route":
                values = pdf_export_job_route(path)
            elif name == "quantity_sheet_pdf_route":
                values = quantity_sheet_pdf_route(path, unquote)
            else:
                values = getattr(handler, name)(path, *spec.get("arguments", ()))
            values = values if isinstance(values, tuple) else (values,)
            if not (values[0] if spec.get("first_only") else all(values)):
                return None
            return {"path": path, **dict(zip(spec["parameters"], values, strict=True))}
        if prefix := spec.get("prefix"):
            # Prefix ownership is intentional: unknown namespace paths retain
            # their existing login checks and domain-specific 404 responses.
            matches = path.startswith(prefix)
            if not prefix.endswith("/"):
                matches = path == prefix or path.startswith(prefix + "/")
        else:
            matches = path in spec["paths"]
        return {"path": path} if matches else None

    return match


def _action(spec):
    def action(handler, params):
        if name := spec.get("delegate"):
            operation = DELEGATES[name]
            handled = (
                operation(handler, params["path"])
                if spec.get("two_args")
                else operation(handler, spec["method"], params["path"])
            )
            return HANDLED if handled else None
        getattr(handler, spec["action"])(**params)
        # A completed download/authentication failure returns None from the old
        # action too. Mark it handled so no second response is sent.
        return HANDLED

    return action


def register_domain_routes(router, *, early=False):
    for specs in ROUTE_GROUPS.values():
        for spec in specs:
            if bool(spec.get("early")) == early:
                router.add_handled(spec["method"], _matcher(spec), _action(spec), paths=spec["paths"])
