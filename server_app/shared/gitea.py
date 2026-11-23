"""Repository identity and server-side routing shared by Gitea integrations."""

from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _http_url(value, error):
    value = str(value or "").strip()
    try:
        parsed = urlsplit(value)
        port = parsed.port
        if (
            parsed.scheme in {"http", "https"}
            and parsed.hostname
            and parsed.username is None
            and parsed.password is None
            and (port is None or port > 0)
            and not any(character.isspace() for character in value)
            and not any(character in value for character in "?#\\")
        ):
            return parsed
    except ValueError:
        pass
    raise ValueError(error)


def parse_gitea_repository_url(value, *, api_url="", config_name="CAGELEDGER_REPOSITORY_URL"):
    repository_error = f"共享仓库地址无效，请检查 {config_name} 是否包含所有者和仓库名"
    parsed = _http_url(value, repository_error)
    path_parts = [part for part in parsed.path.strip("/").split("/") if part]
    if len(path_parts) < 2 or not (repo := path_parts[-1].removesuffix(".git")):
        raise ValueError(repository_error)
    owner = path_parts[-2]
    repository_origin = f"{parsed.scheme}://{parsed.netloc}"
    api_origin = repository_origin
    if api_url:
        api_error = "Gitea API 地址无效，请在 CAGELEDGER_GITEA_API_URL 中填写同一仓库的 HTTP(S) 服务地址"
        parsed_api = _http_url(api_url, api_error)
        api_path = parsed_api.path.rstrip("/").removesuffix(".git")
        if api_path and api_path != f"/{owner}/{repo}":
            raise ValueError(api_error)
        api_origin = f"{parsed_api.scheme}://{parsed_api.netloc}"
    return {"baseUrl": repository_origin, "apiBaseUrl": api_origin, "owner": owner, "repo": repo}
