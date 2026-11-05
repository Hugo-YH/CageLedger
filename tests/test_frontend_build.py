import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import frontend_build as build


class SharedFrontendTests(unittest.TestCase):
    def test_build_is_reused_and_changed_source_or_outputs_force_rebuild(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            repo = parent / "repo"
            repo.mkdir()
            receipt = parent / "receipt.json"
            source = {"source": "v1", "tools": "node22"}

            def compile_once(*args, **kwargs):
                (repo / "web-dist/docs").mkdir(parents=True, exist_ok=True)
                (repo / "web-dist/index.html").write_text(source["source"])
                (repo / "web-dist/docs/index.html").write_text("documentation")

            with (
                patch.object(build, "build_inputs", side_effect=lambda *_: dict(source)),
                patch.object(build.subprocess, "run", side_effect=compile_once) as run,
            ):
                build.build(repo, receipt)
                build.build(repo, receipt)
                self.assertEqual(run.call_count, 1)
                source["source"] = "v2"
                with self.assertRaisesRegex(RuntimeError, "inputs changed"):
                    build.validate(repo, receipt)
                build.build(repo, receipt)
                self.assertEqual(run.call_count, 2)
                (repo / "web-dist/docs/index.html").write_text("stale docs")
                with self.assertRaisesRegex(RuntimeError, "changed"):
                    build.validate(repo, receipt)
                build.build(repo, receipt)
                self.assertEqual(run.call_count, 3)

    def test_checkout_mismatch_and_changes_during_build_cannot_create_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "repo"
            repo.mkdir()
            receipt = root / "receipt.json"
            with (
                patch.object(build, "build_inputs", side_effect=[{"source": "before"}, {"source": "after"}]),
                patch.object(build.subprocess, "run"),
            ):
                with self.assertRaisesRegex(RuntimeError, "changed during"):
                    build.build(repo, receipt)
            self.assertFalse(receipt.exists())
            receipt.write_text(json.dumps({"schema": 1, "repo": "/different"}))
            with self.assertRaisesRegex(RuntimeError, "checkout mismatch"):
                build.validate(repo, receipt, inputs={})
