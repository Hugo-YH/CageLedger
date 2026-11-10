"""Derivative reuse must preserve page scope, evidence and explicit AI reruns."""

import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from threading import Event
from unittest.mock import Mock, patch

from PIL import Image, ImageDraw

from server_app.domains.reception import certificate_ai as ai
from server_app.domains.reception import certificate_image as image
from server_app.domains.reception import certificate_pages as pages
from server_app.domains.reception.certificate_cache import CertificateCache


def png(color="white"):
    source = Image.new("RGB", (600, 900), color)
    ImageDraw.Draw(source).rectangle((150, 200, 450, 450), outline="red", width=3)
    with BytesIO() as output:
        source.save(output, format="PNG")
        return output.getvalue()


class CertificateCacheTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="certificate-cache-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.cache = CertificateCache(self.root / "cache")
        for module in (pages, image):
            patcher = patch.object(module, "cache", self.cache)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_warm_pages_keep_bytes_and_selection_but_all_mode_includes_the_photo(self):
        original, preview = b"%PDF-source-one", png()
        dimensions = [(1, 595, 842), (2, 595, 842), (3, 4032, 2268)]
        with (
            patch.object(pages, "_info", return_value=dimensions) as info,
            patch.object(pages.files, "render_page", return_value=preview) as render,
        ):
            cold = pages.prepare(original, 3, preview)
            warm = pages.prepare(original, 3, preview)
            self.assertEqual(cold, warm)
            self.assertEqual(info.call_count, 1)
            self.assertEqual([call.args[2] for call in render.call_args_list], [2])
            all_images, selection = pages.prepare(original, 3, preview, include_all=True)
            self.assertEqual([item["pageNumber"] for item in all_images], [1, 2, 3])
            self.assertEqual(selection["skippedPhotoPages"], [])
            self.assertEqual([call.args[2] for call in render.call_args_list], [2, 3])
            pages.prepare(b"%PDF-source-two", 3, preview)
            self.assertEqual(info.call_count, 2)
            self.assertEqual(render.call_count, 3)
            with patch.object(pages, "MAX_IMAGES_BYTES", len(preview)), self.assertRaisesRegex(ValueError, "30MiB"):
                pages.prepare(original, 3, preview)
            self.assertEqual(render.call_count, 3)

    def test_preprocessing_is_reused_but_each_recognition_still_calls_ai_with_new_line_ids(self):
        original = png()
        payload = {
            "certificates": [{"certificateNo": "CERT-1", "grade": "SPF", "lines": [{"sex": "雄性", "quantity": 2}]}]
        }
        with (
            patch.object(image, "_prepare", wraps=image._prepare) as process,
            patch.object(ai, "deepseek_chat_json", return_value=(payload, {})) as provider,
        ):
            first, first_raw, _ = ai.recognize(original, "attachment", "run-1", {"species": "mouse"})
            second, second_raw, _ = ai.recognize(original, "attachment", "run-2", {"species": "mouse"})
            self.assertEqual(process.call_count, 1)
            self.assertEqual(provider.call_count, 2)
            self.assertEqual(first_raw["pages"], second_raw["pages"])
            self.assertEqual(provider.call_args_list[0].kwargs["image_urls"], provider.call_args.kwargs["image_urls"])
            self.assertNotEqual(first["lines"][0]["id"], second["lines"][0]["id"])
            with patch.object(image, "VERSION", "next-preprocessor"):
                image.prepare(original)
            image.prepare(png("ivory"))
            self.assertEqual(process.call_count, 3)

    def test_corrupt_truncated_or_symlinked_entry_is_rebuilt_without_changing_evidence(self):
        original = png()
        expected = image.prepare(original)
        entry = next(self.cache.root.glob("*.cache"))
        for bad in (b"partial", entry.read_bytes()[:-1], b"CLCC1\n" + b"\xff" * 4):
            with self.subTest(length=len(bad)):
                entry.write_bytes(bad)
                with patch.object(image, "_prepare", wraps=image._prepare) as process:
                    self.assertEqual(image.prepare(original), expected)
                    process.assert_called_once()
        evidence = self.root / "immutable.png"
        evidence.write_bytes(original)
        entry.unlink()
        entry.symlink_to(evidence)
        self.assertEqual(image.prepare(original), expected)
        self.assertEqual(evidence.read_bytes(), original)
        self.assertFalse(entry.is_symlink())

    def test_disk_failure_and_expiry_recompute_instead_of_losing_success(self):
        create = Mock(return_value=(b"derived", {"page": 2}))
        with patch.object(self.cache, "_write", side_effect=OSError("disk full")):
            self.assertEqual(self.cache.remember("page", "sha", create), create.return_value)
        self.cache.remember("page", "sha", create)
        entry = next(self.cache.root.glob("*.cache"))
        os.utime(entry, (1, 1))
        self.cache.remember("page", "sha", create)
        self.assertEqual(create.call_count, 3)
        with patch.object(self.cache, "_write", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(ValueError, "incomplete page"):
                self.cache.remember("page", "failed", Mock(side_effect=ValueError("incomplete page")))

    def test_capacity_and_concurrent_fill_are_bounded(self):
        cache = CertificateCache(self.root / "small", max_bytes=1024, max_entries=2)
        started, release = Event(), Event()

        def create():
            started.set()
            if not release.wait(timeout=5):
                raise AssertionError("fill was not released")
            return b"same page", {"page": 2}

        producer = Mock(side_effect=create)
        with ThreadPoolExecutor(max_workers=3) as executor:
            pending = [executor.submit(cache.remember, "page", "same", producer) for _ in range(3)]
            self.assertTrue(started.wait(timeout=5))
            release.set()
            self.assertEqual([job.result(timeout=5) for job in pending], [(b"same page", {"page": 2})] * 3)
        producer.assert_called_once()
        for number in range(5):
            cache.remember("page", number, lambda: (b"p" * 300, {}))
        entries = list(cache.root.glob("*.cache"))
        self.assertLessEqual(len(entries), 2)
        self.assertLessEqual(sum(path.stat().st_size for path in entries), 1024)
        self.assertEqual(list(cache.root.glob("*.tmp")), [])
