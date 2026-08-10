from http import HTTPStatus

from server_app.domains.intake.strain_standard import standardize_strain
from server_app.shared import clean_text
from server_app.web import JsonResponse


def intake_strain_standardize_handler(handler, _params):
    if not handler.current_user():
        return JsonResponse({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
    try:
        body = handler.read_json_body()
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
    strain = clean_text(str(body.get("strain") or ""))
    if not strain:
        return JsonResponse({"item": ""})
    return JsonResponse({"item": standardize_strain(strain)})
