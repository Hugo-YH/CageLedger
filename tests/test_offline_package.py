"""Exercise the actual packaging shell and native tar on a tiny isolated checkout."""

import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
APPLEDOUBLE_MAGIC = b"\x00\x05\x16\x07"


class OfflinePackageTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="cageledger-package-test-")
        self.addCleanup(temporary.cleanup)
        self.temp = Path(temporary.name)
        self.root = self.temp / "CageLedger"
        (self.root / "scripts").mkdir(parents=True)
        shutil.copyfile(PROJECT / "scripts/package_offline.sh", self.root / "scripts/package_offline.sh")
        # Build behavior is outside this regression: use prebuilt fixture bytes,
        # but exercise the real script's npm path and actual tar invocation.
        (self.root / "package.json").write_text(
            json.dumps({"version": "1.2.3", "scripts": {"build": 'node -e "process.exit(0)"'}})
        )
        self.files = {
            "web-dist/index.html": b"application fixture\n",
            "web-dist/docs/index.html": b"documentation fixture\n",
            "scripts/start.sh": b"#!/bin/sh\nexit 0\n",
            "notes/normal.txt": b"normal file bytes\x00\xff",
            # Do not indiscriminately exclude ordinary files with a ._ prefix.
            "notes/._ordinary.txt": b"intentional application content",
        }
        for name, content in self.files.items():
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            target.chmod(0o755 if name.endswith(".sh") else 0o640)
        (self.root / "notes").chmod(0o750)
        (self.root / "notes/relative-link").symlink_to("normal.txt")
        self.env = dict(os.environ)
        self.env.pop("COPYFILE_DISABLE", None)
        self.env.pop("CAGELEDGER_RELEASE_BUILD_RECEIPT", None)

    def package_and_check(self):
        result = subprocess.run(
            ["bash", "scripts/package_offline.sh"],
            cwd=self.root,
            env=self.env,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        package = self.root / "dist/CageLedger-offline-1.2.3.tar.gz"
        with tarfile.open(package) as archive:
            members = archive.getmembers()
            self.assertTrue(all(Path(member.name).parts[0] == self.root.name for member in members))
            for name, content in self.files.items():
                member = archive.getmember(f"CageLedger/{name}")
                self.assertTrue(member.isfile())
                self.assertEqual(archive.extractfile(member).read(), content)
                self.assertEqual(member.mode & 0o7777, 0o755 if name.endswith(".sh") else 0o640)
            self.assertEqual(archive.getmember("CageLedger/notes").mode & 0o7777, 0o750)
            link = archive.getmember("CageLedger/notes/relative-link")
            self.assertTrue(link.issym())
            self.assertEqual(link.linkname, "normal.txt")
            sidecars = [member for member in members if Path(member.name).name.startswith("._")]
            self.assertEqual([member.name for member in sidecars], ["CageLedger/notes/._ordinary.txt"])
            for member in sidecars:
                self.assertNotEqual(archive.extractfile(member).read(4), APPLEDOUBLE_MAGIC)
        return package

    def test_real_package_preserves_file_bytes_modes_and_relative_links(self):
        self.package_and_check()

    @unittest.skipUnless(sys.platform == "darwin", "AppleDouble generation is macOS-specific")
    def test_macos_metadata_reproduces_old_failure_but_is_not_packaged(self):
        finder_info = b"TEXTttxt" + bytes(24)
        subprocess.run(["xattr", "-wx", "com.apple.FinderInfo", finder_info.hex(), str(self.root)], check=True)
        subprocess.run(
            ["xattr", "-w", "com.cageledger.package-test", "synthetic metadata", str(self.root / "notes/normal.txt")],
            check=True,
        )
        control = self.temp / "native-with-metadata.tar.gz"
        subprocess.run(
            ["tar", "-czf", str(control), "-C", str(self.temp), self.root.name],
            env=self.env,
            check=True,
            capture_output=True,
            timeout=30,
        )
        with tarfile.open(control) as archive:
            member = archive.getmember("._CageLedger")
            self.assertEqual(archive.extractfile(member).read(4), APPLEDOUBLE_MAGIC)
        self.package_and_check()
        # Packaging must not strip attributes from the source files themselves.
        self.assertEqual(
            bytes.fromhex(subprocess.check_output(["xattr", "-px", "com.apple.FinderInfo", str(self.root)], text=True)),
            finder_info,
        )
        self.assertEqual(
            subprocess.check_output(
                ["xattr", "-p", "com.cageledger.package-test", str(self.root / "notes/normal.txt")]
            ).rstrip(b"\n"),
            b"synthetic metadata",
        )


if __name__ == "__main__":
    unittest.main()
