import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DIST_PATH = ROOT / "web-dist"
_configured_db_path = os.environ.get("CAGELEDGER_DB", "").strip()
DATA_ROOT = Path(
    os.environ.get("CAGELEDGER_DATA_ROOT", _configured_db_path and Path(_configured_db_path).parent or ROOT / "data")
)
DB_PATH = Path(_configured_db_path or DATA_ROOT / "database" / "cageledger.sqlite")
PDF_CACHE_PATH = Path(os.environ.get("CAGELEDGER_PDF_CACHE", DATA_ROOT / "cache" / "pdf"))
ANIMAL_INSPECTION_ATTACHMENTS_PATH = Path(
    os.environ.get(
        "CAGELEDGER_ANIMAL_INSPECTION_ATTACHMENTS", DATA_ROOT / "files" / "animal-inspections" / "attachments"
    )
)
ANIMAL_INSPECTION_IMAGES_PATH = Path(
    os.environ.get(
        "CAGELEDGER_ANIMAL_INSPECTION_IMAGES", DATA_ROOT / "files" / "animal-inspections" / "reference-images"
    )
)
REIMBURSEMENT_ATTACHMENTS_PATH = Path(
    os.environ.get("CAGELEDGER_REIMBURSEMENT_ATTACHMENTS", DATA_ROOT / "files" / "reimbursements" / "attachments")
)
ANIMAL_INSPECTION_CATALOG_PATH = ROOT / "server_app" / "resources" / "animal_inspection" / "v1"
IACUC_INDEX_PATH = Path(os.environ.get("CAGELEDGER_IACUC_INDEX", DATA_ROOT / "indexes" / "iacuc" / "index.json"))
LEGACY_IACUC_INDEX_PATH = ROOT / "src" / "iacuc-data.local.json"
HOST = os.environ.get("CAGELEDGER_HOST", "0.0.0.0")
PORT = int(os.environ.get("CAGELEDGER_PORT", "5173"))
# File uploads reserve a small multipart envelope beyond the 10 MiB per-image limit.
# Multipart endpoints apply their own file-type and size limits. The largest current
# upload is a 30 MiB reimbursement attachment plus its multipart envelope.
MAX_BODY_BYTES = 32 * 1024 * 1024
SESSION_COOKIE = "cageledger_session"
SESSION_TTL_DAYS = 14


def frontend_root():
    if os.environ.get("CAGELEDGER_DEV_ASSETS", "").strip().lower() in {"1", "true", "yes", "on"}:
        return ROOT
    return WEB_DIST_PATH if (WEB_DIST_PATH / "index.html").exists() else ROOT


DEFAULT_ADMIN_USERNAME = os.environ.get("CAGELEDGER_ADMIN_USERNAME", "admin")
DEFAULT_ADMIN_PASSWORD = os.environ.get("CAGELEDGER_ADMIN_PASSWORD", "admin123")

CAGELEDGER_REVISION = os.environ.get("CAGELEDGER_REVISION", os.environ.get("CAGELEDGER_VERSION", "")).strip()
CAGELEDGER_VERSION = CAGELEDGER_REVISION
CAGELEDGER_APP_VERSION = os.environ.get("CAGELEDGER_APP_VERSION", "").strip()
CAGELEDGER_APP_BUILD = os.environ.get("CAGELEDGER_APP_BUILD", "").strip()
CAGELEDGER_ORGANIZATION = os.environ.get("CAGELEDGER_ORGANIZATION", "中山大学中山眼科中心").strip()
CAGELEDGER_DEPARTMENT = os.environ.get("CAGELEDGER_DEPARTMENT", "实验动物中心").strip()
CAGELEDGER_DEVELOPER = os.environ.get("CAGELEDGER_DEVELOPER", "Hugo").strip()
CAGELEDGER_CONTACT_EMAIL = os.environ.get("CAGELEDGER_CONTACT_EMAIL", "info@cellnucle.us").strip()
CAGELEDGER_LICENSE = os.environ.get("CAGELEDGER_LICENSE", "Apache-2.0").strip()
CAGELEDGER_COPYRIGHT = os.environ.get(
    "CAGELEDGER_COPYRIGHT",
    f"© 2026 {CAGELEDGER_ORGANIZATION} {CAGELEDGER_DEPARTMENT}. Licensed under Apache-2.0.",
).strip()
CAGELEDGER_REPOSITORY_URL = os.environ.get(
    "CAGELEDGER_REPOSITORY_URL",
    os.environ.get("CAGELEDGER_REPOSITORY", "https://git.cellnucle.us/hugo/cageledger"),
).strip()
CAGELEDGER_BRANCH = os.environ.get("CAGELEDGER_BRANCH", "main")
CAGELEDGER_GITEA_TOKEN = os.environ.get("CAGELEDGER_GITEA_TOKEN", "").strip()
CAGELEDGER_UPDATE_CHECK_ENABLED = os.environ.get("CAGELEDGER_UPDATE_CHECK_ENABLED", "false").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_API_URL = os.environ.get("DEEPSEEK_API_URL", "https://api.deepseek.com/chat/completions").strip()
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat").strip()
DEEPSEEK_TIMEOUT_SECONDS = int(os.environ.get("DEEPSEEK_TIMEOUT_SECONDS", "30"))
