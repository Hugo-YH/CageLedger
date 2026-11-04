"""Command-line entry for managed releases, diagnostics and read-only status."""

import argparse
import re
import signal
import sys
import tarfile
from pathlib import Path

from release_browsers import managed_pdf_browser
from release_completion import Completion
from release_credentials import noninteractive_credentials, release_api_credentials
from release_reporting import show_status
from release_runtime import ROOT, atomic_json, command, digest, release_lock, require, validate_build
from release_tools import release_converter
from verification_host import check_browser_slots, host_task_lock


def main(pipeline_class):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sign", action="store_true", help="Sign and verify release commit/tag (default: unsigned)")
    parser.add_argument("--doctor", action="store_true", help="Diagnose release prerequisites without releasing")
    parser.add_argument("--online", action="store_true", help="Also check Gitea access during --doctor")
    parser.add_argument("--status", action="store_true", help="Read the journal specified by --state-dir")
    parser.add_argument("positional_version", nargs="?")
    parser.add_argument("--version")
    parser.add_argument("--bump")
    parser.add_argument("--push", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--skip-full-verify", action="store_true", help="Compatibility alias: reuse only verified matching receipts"
    )
    parser.add_argument(
        "--browser-slots",
        type=int,
        choices=(1, 2),
        default=1,
        help="Maximum independent browser groups (default: 1; resource guard may reduce 2)",
    )
    parser.add_argument("--state-dir", type=Path)
    parser.add_argument(
        "--source-checkout",
        type=Path,
        help="Protect originals and fast-forward a clean source checkout after publishing",
    )
    parser.add_argument("--validate-build", type=Path)
    parser.add_argument(
        "--verify-only", action="store_true", help="Prepare and verify without committing/tagging/pushing"
    )
    args = parser.parse_args()
    require(not args.online or args.doctor, "--online requires --doctor")
    require(sum((args.doctor, args.status, bool(args.validate_build))) <= 1, "Choose one diagnostic mode")
    if args.doctor or args.status:
        require(
            not (args.push or args.verify_only or args.dry_run), "Diagnostics cannot be combined with release actions"
        )
    if args.status:
        require(args.state_dir is not None, "--status requires --state-dir")
        show_status(args.state_dir)
        return
    if args.doctor:
        from release_doctor import diagnose

        require(diagnose(ROOT, sign=args.sign, online=args.online), "预检发现未就绪项；按上方提示修复后重试。")
        return
    if args.validate_build:
        validate_build(args.validate_build, ROOT)
        return
    version = args.version or args.positional_version
    if not version:
        version = command(["node", "scripts/bump_version.mjs", "--bump", args.bump or "beta"])
    require(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.-]*", version), "Invalid version")
    if args.dry_run:
        print(
            f"preflight → prepare → check → build → 3 Chromium shards + Firefox + WebKit (up to {args.browser_slots} slots) → offline package"
        )
        print(
            ("→ signed commit/tag" if args.sign else "→ unsigned commit + annotated tag")
            if not args.verify_only
            else "→ stop before commit/tag"
        )
        if args.push and not args.verify_only:
            print("→ version images → Git refs → Release → Wiki → delivery/offline verification → latest")
        return
    from release_host_guard import HostGuard

    directory = (args.state_dir or (ROOT.parent / (ROOT.name + "-release-state") / version)).resolve()
    # State must be excluded from source fingerprints and archive packaging.
    require(
        not directory.is_relative_to(ROOT),
        "State must be outside checkout",
    )
    check_browser_slots(args.browser_slots, ROOT)
    completed, completion = False, None
    with host_task_lock(), release_lock(ROOT), noninteractive_credentials(), release_api_credentials(ROOT):
        try:
            with release_converter(ROOT) as converter_session, managed_pdf_browser(ROOT):
                guard = HostGuard(directory / "host")
                pipeline = pipeline_class(
                    ROOT, version, directory, guard, browser_slots=args.browser_slots, sign=args.sign
                )
                for sig in (signal.SIGINT, signal.SIGTERM):
                    signal.signal(sig, lambda _s, _f: pipeline.runner.stopping.set())
                completion = Completion(pipeline, args.source_checkout)
                completion.converter = converter_session
                pipeline.preflight()
                require(guard.admit(), guard.reason)
                pipeline.prepare()
                frozen = pipeline.journal.data.get("release_input")
                require(
                    not frozen or frozen == pipeline.fingerprint(),
                    "Release input/runtime changed after commit; use a new version",
                )
                pipeline.stage("converter-smoke", [sys.executable, "scripts/check_release_converter.py"])
                pipeline.stage("check", ["npm", "run", "check:steps"])
                pipeline.stage("build", ["npm", "run", "build"], [ROOT / "web-dist", ROOT / ".vitepress/dist"])
                pipeline.browsers()
                package = ROOT / "dist" / f"CageLedger-offline-{version}.tar.gz"
                pipeline.stage(
                    "package",
                    ["bash", "scripts/package_offline.sh"],
                    [package],
                    env={**pipeline.environment, "CAGELEDGER_RELEASE_BUILD_RECEIPT": str(pipeline.journal.path)},
                    inputs=[ROOT / "web-dist", ROOT / ".vitepress/dist"],
                )
                from release_verify_offline import archive_check

                with tarfile.open(package) as bundle:
                    package_safety = archive_check(bundle, ROOT)
                atomic_json(directory / "package-safety.json", {"sha256": digest(package), **package_safety})
                if not args.verify_only:
                    pipeline.journal.data["release_input"] = pipeline.fingerprint()
                    pipeline.journal.save()
                    pipeline.commit_and_tag()
                    if args.push:
                        pipeline.publish()
                completed = True
                print(f"Release stages complete; evidence: {directory}")
        finally:
            if completion:
                published = completion.journal.data["stages"].get("latest", {}).get("status") == "passed"
                completion.finish(completed, published)
