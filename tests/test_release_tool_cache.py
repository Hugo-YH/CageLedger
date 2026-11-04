import hashlib
import json
import os
import plistlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import release_tools as tools


class ToolCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.image = self.root / "LibreOffice.dmg"
        self.image.write_bytes(b"test media")
        self.mount = self.root / "mounted"
        self.metadata = self.root / "libreoffice-1.2.3.json"
        self.value = {
            "version": "1.2.3",
            "image": str(self.image),
            "mount": str(self.mount),
            "sha256": hashlib.sha256(self.image.read_bytes()).hexdigest(),
        }
        self.write()
        environment = patch.dict(os.environ, {"CAGELEDGER_RELEASE_TOOLS_DIR": str(self.root)}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def write(self):
        self.metadata.write_text(json.dumps(self.value))

    def binary(self):
        target = self.mount / "LibreOffice.app/Contents/MacOS/soffice"
        target.parent.mkdir(parents=True)
        target.write_text("test converter")
        return target

    def installed(self, path):
        if str(path).startswith("/Applications/"):
            return False
        return path.exists() and not path.is_dir()

    def test_hash_and_cache_boundaries(self):
        self.assertEqual(tools.cached_converter(self.root), (self.image, self.mount))
        self.image.write_bytes(b"changed")
        with self.assertRaisesRegex(RuntimeError, "SHA256"):
            tools.cached_converter(self.root)
        self.value["image"] = "/etc/hosts"
        self.write()
        with self.assertRaisesRegex(RuntimeError, "目录内"):
            tools.cached_converter(self.root)

    def test_explicit_path_never_falls_back_or_mounts(self):
        with (
            patch.dict(os.environ, {"CAGELEDGER_LIBREOFFICE_BIN": "/missing/explicit"}),
            patch.object(tools, "command") as run,
        ):
            with tools.release_converter(self.root):
                self.assertEqual(os.environ["CAGELEDGER_LIBREOFFICE_BIN"], "/missing/explicit")
            run.assert_not_called()

    def test_existing_mount_is_reused_and_not_ejected(self):
        binary = self.binary()
        with (
            patch.object(tools.sys, "platform", "darwin"),
            patch.object(Path, "is_file", lambda path: self.installed(path)),
            patch.object(tools, "mounted_image", return_value=self.image),
            patch.object(tools, "command") as run,
        ):
            with tools.release_converter(self.root):
                self.assertEqual(os.environ["CAGELEDGER_LIBREOFFICE_BIN"], str(binary))
        run.assert_not_called()
        self.assertNotIn("CAGELEDGER_LIBREOFFICE_BIN", os.environ)

    def test_own_readonly_mount_cleaned_even_after_body_failure(self):
        def command(args, *_args, **_kwargs):
            if args[0] == "hdiutil":
                self.assertIn("-readonly", args)
                self.binary()
                return plistlib.dumps(
                    {"system-entities": [{"mount-point": str(self.mount), "dev-entry": "/dev/test-owned"}]}
                ).decode()
            return ""

        with (
            patch.object(tools.sys, "platform", "darwin"),
            patch.object(Path, "is_file", lambda path: self.installed(path)),
            patch.object(tools, "mounted_image", return_value=None),
            patch.object(tools, "command", side_effect=command) as run,
        ):
            with self.assertRaisesRegex(RuntimeError, "body failed"), tools.release_converter(self.root):
                raise RuntimeError("body failed")
        self.assertEqual(run.call_args_list[-1].args[0], ["diskutil", "eject", "/dev/test-owned"])

    def test_other_mounted_image_never_replaced(self):
        with (
            patch.object(tools.sys, "platform", "darwin"),
            patch.object(Path, "is_file", lambda path: self.installed(path)),
            patch.object(tools, "mounted_image", return_value=self.root / "other.dmg"),
            patch.object(tools, "command") as run,
        ):
            with self.assertRaisesRegex(RuntimeError, "其他镜像"), tools.release_converter(self.root):
                self.fail("must reject conflicting mount")
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
