"""Select the Gitea Git/API origin independently of the container registry."""

import os
from urllib.parse import urlsplit

DEFAULT_GITEA_URL = "http://ddns.cellnucle.us:3333"
HTTPS_GITEA_URL = "https://git.cellnucle.us"
REPOSITORY_PATH = "/hugo/cageledger"


def gitea_url():
    """Require an origin, not a repository URL or a URL containing credentials."""
    value = os.environ.get("CAGELEDGER_GITEA_URL", "").strip() or DEFAULT_GITEA_URL
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError:
        raise ValueError("CAGELEDGER_GITEA_URL must be an HTTP(S) origin") from None
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or any(char.isspace() for char in value)
        or (port is not None and port <= 0)
    ):
        raise ValueError("CAGELEDGER_GITEA_URL must be an HTTP(S) origin")
    return value.rstrip("/")


def gitea_git_remote():
    return gitea_url() + REPOSITORY_PATH + ".git"
