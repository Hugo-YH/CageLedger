"""Internal OCR seam. Providers stay disabled until an approved local service is connected."""

from typing import Protocol, TypedDict


class OcrFieldCandidate(TypedDict, total=False):
    value: str
    confidence: float
    page: int
    bbox: list[float]


class OcrResult(TypedDict, total=False):
    fields: dict[str, list[OcrFieldCandidate]]
    rawText: str


class OcrProvider(Protocol):
    name: str
    model_version: str

    def submit(self, attachment_path: str) -> str: ...

    def status(self, task_id: str) -> tuple[str, OcrResult | None, str]: ...


class DisabledOcrProvider:
    name = "disabled"
    model_version = ""

    def submit(self, attachment_path: str) -> str:
        raise RuntimeError("OCR 服务尚未启用")

    def status(self, task_id: str) -> tuple[str, OcrResult | None, str]:
        return "disabled", None, "OCR 服务尚未启用"
