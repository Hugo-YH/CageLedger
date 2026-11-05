"""Build application/docs once and validate their shared, content-addressed receipt."""

import argparse
import json
import os
import subprocess
from pathlib import Path

from release_runtime import ROOT, atomic_json, command, digest, require, source_fingerprint, tree


def default_receipt(repo):
    return repo.parent / f"{repo.name}-build-state" / "frontend.json"


def build_inputs(repo):
    node = json.loads(command(["node", "-p", "JSON.stringify({version:process.version,path:process.execPath})"], repo))
    return {
        "source": source_fingerprint(repo),
        "node": {**node, "sha256": digest(Path(node["path"]))},
        "installed_npm_lock": tree(repo / "node_modules/.package-lock.json"),
        "docs_edit_branch": os.environ.get("CAGELEDGER_DOCS_EDIT_BRANCH", "main"),
    }


def validate(repo, receipt, *, inputs=None):
    data = json.loads(Path(receipt).read_text())
    require(data.get("schema") == 1 and data.get("repo") == str(repo.resolve()), "Frontend receipt checkout mismatch")
    require(data.get("inputs") == (inputs or build_inputs(repo)), "Frontend receipt inputs changed")
    output = repo / "web-dist"
    require((output / "index.html").is_file() and (output / "docs/index.html").is_file(), "Built pages are missing")
    require(data.get("outputs") == tree(output), "Built frontend/docs changed; rebuild instead of reusing them")
    return data


def build(repo, receipt):
    require(not receipt.resolve().is_relative_to(repo.resolve()), "Frontend build receipt must be outside the checkout")
    inputs = build_inputs(repo)
    if receipt.is_file():
        try:
            validate(repo, receipt, inputs=inputs)
        except (OSError, ValueError, KeyError, RuntimeError):
            pass
        else:
            print(f"Reuse verified application/docs build: {receipt}", flush=True)
            return
    # Match the Docker build and keep receipt validity independent of Git commit dates.
    subprocess.run(
        ["npm", "run", "build"], cwd=repo, env={**os.environ, "CAGELEDGER_DOCS_LAST_UPDATED": "false"}, check=True
    )
    require(build_inputs(repo) == inputs, "Source/dependencies changed during the frontend build")
    output = repo / "web-dist"
    require(
        (output / "index.html").is_file() and (output / "docs/index.html").is_file(), "Build did not produce both pages"
    )
    atomic_json(receipt, {"schema": 1, "repo": str(repo.resolve()), "inputs": inputs, "outputs": tree(output)})
    print(f"Verified shared application/docs build: {receipt}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("build", "validate"))
    parser.add_argument("--receipt", type=Path, default=default_receipt(ROOT))
    args = parser.parse_args()
    receipt = args.receipt.expanduser().resolve()
    if args.action == "build":
        build(ROOT, receipt)
    else:
        validate(ROOT, receipt)
        print(f"Shared application/docs receipt verified: {receipt}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from None
