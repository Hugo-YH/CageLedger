import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import release_runtime as rt


class ReleaseConverterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.bundle = Path(self.temp.name) / "LibreOffice.app"
        self.binary = self.bundle / "Contents/MacOS/soffice"
        self.binary.parent.mkdir(parents=True)
        self.binary.write_text("mock executable")
        self.binary.chmod(0o700)
        self.environment = patch.dict(os.environ, {"CAGELEDGER_LIBREOFFICE_BIN": str(self.binary)}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.version = "LibreOffice 26.8.2.2 9dea406ab7695df6325b11b0e19fdca8db4b7276"

    def test_only_converter_survives_application_environment_isolation(self):
        with patch.dict(os.environ, {"CAGELEDGER_DB": "/production", "CAGELEDGER_GITEA_TOKEN": "secret"}):
            env = rt.isolation_environment()
        self.assertEqual(env["CAGELEDGER_LIBREOFFICE_BIN"], str(self.binary.resolve()))
        self.assertNotIn("CAGELEDGER_DB", env)
        self.assertNotIn("CAGELEDGER_GITEA_TOKEN", env)
        self.assertEqual(env["CAGELEDGER_EPHEMERAL_DB"], "1")

    def test_missing_converter_fails_closed_without_fallback(self):
        self.binary.unlink()
        with patch.object(rt.shutil, "which") as search, self.assertRaises(OSError):
            rt.isolation_environment()
        search.assert_not_called()

    def test_missing_path_lookup_is_not_optional_at_preflight(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(rt.shutil, "which", return_value=None):
            self.assertIsNone(rt.converter_executable(required=False))
            with self.assertRaisesRegex(RuntimeError, "LibreOffice required"):
                rt.converter_identity()

    def test_non_executable_fails_closed(self):
        self.binary.chmod(0o600)
        with self.assertRaisesRegex(RuntimeError, "executable unavailable"):
            rt.converter_executable()

    def test_bundle_resources_and_version_change_fingerprint(self):
        with patch.object(rt.sys, "platform", "darwin"), patch.object(rt, "command", return_value=self.version) as run:
            first = rt.converter_identity()
            self.assertEqual(run.call_args_list[0].args[0][:4], ["codesign", "--verify", "--deep", "--strict"])
            self.assertEqual(run.call_args_list[1].args[0][:3], ["spctl", "--assess", "--type"])
            resource = self.bundle / "Contents/font.dat"
            resource.write_text("font revision one")
            second = rt.converter_identity()
            resource.write_text("font revision two")
            third = rt.converter_identity()
            self.assertNotEqual(first["bundle_sha256"], second["bundle_sha256"])
            self.assertNotEqual(second["bundle_sha256"], third["bundle_sha256"])
            run.return_value = self.version.replace("26.8.2.2", "26.8.2.3")
            self.assertNotEqual(rt.hashed(third), rt.hashed(rt.converter_identity()))

    def test_signature_assessment_permission_timeout_and_unknown_version_stop(self):
        failures = [
            RuntimeError("signature rejected"),
            PermissionError("denied"),
            subprocess.TimeoutExpired("spctl", 30),
        ]
        for failure in failures:
            with (
                self.subTest(error=type(failure).__name__),
                patch.object(rt.sys, "platform", "darwin"),
                patch.object(rt, "command", side_effect=failure) as run,
                self.assertRaises(type(failure)),
            ):
                rt.converter_identity()
            self.assertEqual(run.call_count, 1)
        with patch.object(rt.sys, "platform", "darwin"), patch.object(rt, "command", side_effect=["", "", "unknown"]):
            with self.assertRaisesRegex(RuntimeError, "Unrecognized"):
                rt.converter_identity()
        with (
            patch.object(rt.sys, "platform", "darwin"),
            patch.object(rt, "command", side_effect=["", RuntimeError("assessment rejected")]) as run,
        ):
            with self.assertRaises(RuntimeError):
                rt.converter_identity()
            self.assertEqual(run.call_count, 2)


if __name__ == "__main__":
    unittest.main()
