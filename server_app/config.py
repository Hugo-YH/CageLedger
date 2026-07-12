import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DIST_PATH = ROOT / "web-dist"
DB_PATH = Path(os.environ.get("CAGELEDGER_DB", ROOT / "data" / "cageledger.sqlite"))
PDF_CACHE_PATH = Path(os.environ.get("CAGELEDGER_PDF_CACHE", DB_PATH.parent / "pdf-cache"))
IACUC_INDEX_PATH = Path(os.environ.get("CAGELEDGER_IACUC_INDEX", DB_PATH.parent / "iacuc-index.json"))
LEGACY_IACUC_INDEX_PATH = ROOT / "src" / "iacuc-data.local.json"
HOST = os.environ.get("CAGELEDGER_HOST", "0.0.0.0")
PORT = int(os.environ.get("CAGELEDGER_PORT", "5173"))
MAX_BODY_BYTES = 10 * 1024 * 1024
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
