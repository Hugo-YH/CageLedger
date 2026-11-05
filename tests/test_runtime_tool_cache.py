import hashlib
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import release_runtime as runtime


class RuntimeToolCacheTests(unittest.TestCase):
    def setUp(self):
        runtime.clear_tool_validation_cache()
        self.addCleanup(runtime.clear_tool_validation_cache)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.browser = self.root / "browser"
        self.browser.mkdir()
        (self.browser / "executable").write_bytes(b"browser executable")
        (self.browser / "library").write_bytes(b"AAAA")

    def test_complete_browser_bytes_are_read_once_and_returned_dicts_cannot_poison_cache(self):
        original_tree, original_digest = runtime.tree, hashlib.file_digest
        with (
            patch.object(runtime, "tree", wraps=original_tree) as tree,
            patch.object(runtime.hashlib, "file_digest", wraps=original_digest) as read,
        ):
            first = runtime.tool_tree(self.browser)
            expected = dict(first)
            first["library"] = "caller mutation"
            self.assertEqual(runtime.tool_tree(self.browser), expected)
            self.assertEqual(tree.call_count, 1)
            self.assertEqual(read.call_count, 2)
            runtime.clear_tool_validation_cache()
            self.assertEqual(runtime.tool_tree(self.browser), expected)
            self.assertEqual(tree.call_count, 2)
            self.assertEqual(read.call_count, 4)

    def test_same_length_change_with_restored_mtime_and_dependency_list_changes_invalidate(self):
        original_tree = runtime.tree
        library = self.browser / "library"
        with patch.object(runtime, "tree", wraps=original_tree) as tree:
            before = runtime.tool_tree(self.browser)
            old = library.stat()
            library.write_bytes(b"BBBB")
            os.utime(library, ns=(old.st_atime_ns, old.st_mtime_ns))
            after = runtime.tool_tree(self.browser)
            self.assertNotEqual(before["library"], after["library"])
            self.assertEqual(tree.call_count, 2)
            dependency = self.browser / "new-dependency"
            dependency.write_bytes(b"new library")
            self.assertIn("new-dependency", runtime.tool_tree(self.browser))
            dependency.unlink()
            self.assertNotIn("new-dependency", runtime.tool_tree(self.browser))
            self.assertEqual(tree.call_count, 4)
            cache = self.browser / "__pycache__"
            cache.mkdir()
            (cache / "import.pyc").write_bytes(b"incidental bytecode")
            self.assertEqual(runtime.tool_tree(self.browser), after)
            self.assertEqual(tree.call_count, 4)

    def test_actual_paths_are_distinct_and_missing_locations_never_seed_mock_success(self):
        other = self.root / "other" / "browser"
        shutil.copytree(self.browser, other)
        alias = self.root / "alias"
        alias.symlink_to(self.browser, target_is_directory=True)
        original_tree = runtime.tree
        with patch.object(runtime, "tree", wraps=original_tree) as tree:
            runtime.tool_tree(self.browser)
            runtime.tool_tree(other)
            runtime.tool_tree(alias)
            self.assertEqual(tree.call_count, 2)
            shutil.rmtree(self.browser)
            with self.assertRaisesRegex(RuntimeError, "Missing artifact"):
                runtime.tool_tree(self.browser)
        absent = self.root / "not-installed"
        with patch.object(runtime, "tree", side_effect=[{"mock": "one"}, {"mock": "two"}]) as tree:
            self.assertEqual(runtime.tool_tree(absent), {"mock": "one"})
            self.assertEqual(runtime.tool_tree(absent), {"mock": "two"})
            self.assertEqual(tree.call_count, 2)

    def test_converter_signatures_version_and_bundle_repeat_only_after_installation_changes(self):
        bundle = self.root / "LibreOffice.app"
        executable = bundle / "Contents/MacOS/soffice"
        executable.parent.mkdir(parents=True)
        executable.write_bytes(b"fake executable")
        executable.chmod(0o755)
        dependency = bundle / "Contents/filter-library"
        dependency.write_bytes(b"AAAA")
        version = "LibreOffice 26.8.2 abc123"
        commands = []

        def command(arguments, *args, **kwargs):
            commands.append(arguments[0])
            if arguments[0] == "codesign" and not dependency.exists():
                raise RuntimeError("Missing signed dependency")
            return version if arguments[0] == str(executable) else ""

        original_tree = runtime.tree
        with (
            patch.object(runtime.sys, "platform", "darwin"),
            patch.dict(os.environ, {"CAGELEDGER_LIBREOFFICE_BIN": str(executable)}),
            patch.object(runtime, "command", side_effect=command),
            patch.object(runtime, "tree", wraps=original_tree) as tree,
        ):
            first = runtime.converter_identity()
            first["version"] = "poisoned"
            second = runtime.converter_identity()
            self.assertEqual(second["version"], version)
            self.assertEqual(commands.count("codesign"), 1)
            self.assertEqual(commands.count("spctl"), 1)
            self.assertEqual(commands.count(str(executable)), 1)
            self.assertEqual(tree.call_count, 1)
            old = dependency.stat()
            dependency.write_bytes(b"BBBB")
            os.utime(dependency, ns=(old.st_atime_ns, old.st_mtime_ns))
            third = runtime.converter_identity()
            self.assertNotEqual(second["bundle_sha256"], third["bundle_sha256"])
            self.assertEqual(commands.count("codesign"), 2)
            self.assertEqual(commands.count("spctl"), 2)
            self.assertEqual(tree.call_count, 2)
            dependency.unlink()
            with self.assertRaisesRegex(RuntimeError, "Missing signed dependency"):
                runtime.converter_identity()
            self.assertEqual(commands.count("codesign"), 3)

    def test_runtime_fingerprint_output_is_unchanged_and_source_output_trees_are_not_tool_cached(self):
        repo = self.root / "repo"
        lock = repo / "node_modules/.package-lock.json"
        lock.parent.mkdir(parents=True)
        lock.write_text("{}")
        node, python = self.root / "node", self.root / "python"
        node.write_bytes(b"node binary")
        python.write_bytes(b"python binary")
        converter = {"bundle_sha256": "signed converter identity"}

        def command(arguments, *args, **kwargs):
            if arguments == ["node", "--version"]:
                return "v22.23.3"
            if arguments == ["node", "-p", "process.execPath"]:
                return str(node)
            if arguments == ["uname", "-a"]:
                return "mock platform"
            if arguments == [str(python), "-m", "pip", "freeze", "--all"]:
                return "dependency==1.0"
            self.fail(f"Unexpected runtime command: {arguments}")

        original_tree = runtime.tree
        with (
            patch.object(runtime, "browser_installations", return_value=[self.browser]),
            patch.object(runtime, "converter_identity", return_value=converter),
            patch.object(runtime, "command", side_effect=command),
            patch.object(runtime.sys, "executable", str(python)),
            patch.object(runtime, "tree", wraps=original_tree) as tree,
        ):
            first = runtime.runtime_fingerprint(repo)
            self.assertEqual(runtime.runtime_fingerprint(repo), first)
            browser_calls = [call for call in tree.call_args_list if Path(call.args[0]) == self.browser]
            output_calls = [call for call in tree.call_args_list if Path(call.args[0]) == lock]
            self.assertEqual(len(browser_calls), 1)
            self.assertEqual(len(output_calls), 2)
            expected = {
                "python": runtime.digest(python),
                "python_version": sys.version,
                "node": "v22.23.3",
                "node_binary": runtime.digest(node),
                "platform": "mock platform",
                "browsers": {str(self.browser): original_tree(self.browser)},
                "pdf_chromium": os.environ.get("CAGELEDGER_RELEASE_PDF_CHROMIUM"),
                "converter": converter,
                "npm_install": original_tree(lock),
                "environment": {key: os.environ.get(key, "") for key in ("TZ", "LANG", "LC_ALL")},
                "python_install": "dependency==1.0",
            }
            self.assertEqual(first, runtime.hashed(expected))
            lock.write_text('{"changed":true}')
            self.assertNotEqual(runtime.runtime_fingerprint(repo), first)
