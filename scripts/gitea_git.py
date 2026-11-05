"""Run explicit Git transport commands with child-only, HTTPS-scoped auth."""

import os
import subprocess
import sys

from release_endpoints import HTTPS_GITEA_URL


def git_environment(environ=None):
    environment = dict(os.environ if environ is None else environ)
    token = environment.get("CAGELEDGER_GITEA_TOKEN", "")
    if token:
        if any(char.isspace() for char in token):
            raise ValueError("Gitea token format is invalid")
        try:
            count = int(environment.get("GIT_CONFIG_COUNT", "0"))
        except ValueError:
            raise ValueError("Inherited Git configuration count is invalid") from None
        if count < 0 or any(
            f"GIT_CONFIG_{kind}_{index}" not in environment for index in range(count) for kind in ("KEY", "VALUE")
        ):
            raise ValueError("Inherited Git configuration is incomplete")
        settings = (
            (f"http.{HTTPS_GITEA_URL}/.extraHeader", "Authorization: token " + token),
            (f"http.{HTTPS_GITEA_URL}/.followRedirects", "false"),
        )
        for key, value in settings:
            environment[f"GIT_CONFIG_KEY_{count}"] = key
            environment[f"GIT_CONFIG_VALUE_{count}"] = value
            count += 1
        environment["GIT_CONFIG_COUNT"] = str(count)
        environment["GIT_TRACE_REDACT"] = "1"
    environment.setdefault("GIT_TERMINAL_PROMPT", "0")
    return environment


def main(arguments=None):
    arguments = sys.argv[1:] if arguments is None else arguments
    if not arguments or arguments[0] not in {"ls-remote", "fetch", "push"}:
        raise ValueError("Usage: gitea_git.py <ls-remote|fetch|push> [arguments ...]")
    return subprocess.run(["git", *arguments], env=git_environment(), check=False).returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError):
        raise SystemExit("Unable to run Gitea Git; check arguments and credential/configuration bindings") from None
