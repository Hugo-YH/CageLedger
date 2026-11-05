import io
import plistlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import setup_macos_runner as setup


class MacRunnerSetupTests(unittest.TestCase):
    def test_service_uses_native_host_registration_and_preserves_existing_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            root = home / "Library/Application Support/CageLedgerRunner"
            config, service = setup.prepare_files(root, home, root / "gitea-runner")
            self.assertIn("capacity: 1", config.read_text())
            self.assertIn("macos-arm64:host", config.read_text())
            self.assertFalse((root / ".runner").exists())
            value = plistlib.loads(service.read_bytes())
            self.assertEqual(value["WorkingDirectory"], str(root))
            self.assertEqual(value["ProgramArguments"], [str(root / "gitea-runner"), "-c", str(config), "daemon"])
            config.write_text("custom configuration")
            before = service.read_bytes()
            setup.prepare_files(root, home, root / "different-binary")
            self.assertEqual(config.read_text(), "custom configuration")
            self.assertEqual(service.read_bytes(), before)

    def test_failed_checksum_does_not_install_or_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(setup.urllib.request, "urlopen", return_value=io.BytesIO(b"untrusted download")):
                with self.assertRaisesRegex(ValueError, "SHA256"):
                    setup.install_binary(root)
            self.assertFalse((root / "gitea-runner").exists())
            (root / "gitea-runner").write_bytes(b"existing user binary")
            with self.assertRaisesRegex(ValueError, "Existing runner"):
                setup.install_binary(root)
            self.assertEqual((root / "gitea-runner").read_bytes(), b"existing user binary")
