from dataclasses import dataclass
from http import HTTPStatus
from typing import Any


@dataclass(frozen=True)
class JsonResponse:
    payload: Any
    status: HTTPStatus = HTTPStatus.OK
