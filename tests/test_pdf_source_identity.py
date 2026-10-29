import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server_app.pdf.cache import PdfExportCache
from server_app.web import pdf_exports


class PdfSourceIdentityTests(unittest.TestCase):
    def test_quantity_pdf_key_tracks_content_even_when_a_legacy_version_is_reused(self):
        first = {"id": "sheet", "updatedAt": "same", "rows": [{"date": "2026-10-01", "cageCount": 1}]}
        second = {**first, "rows": [{"date": "2026-10-01", "cageCount": 2}]}
        self.assertNotEqual(pdf_exports.quantity_pdf_cache_key(first), pdf_exports.quantity_pdf_cache_key(second))
        self.assertEqual(
            pdf_exports.quantity_pdf_cache_key(first), pdf_exports.quantity_pdf_cache_key(copy.deepcopy(first))
        )

    def test_read_before_update_then_render_after_invalidation_cannot_poison_the_current_pdf(self):
        old = {"id": "sheet", "updatedAt": "v1", "rows": [{"cageCount": 1}]}
        fresh = {"id": "sheet", "updatedAt": "v2", "rows": [{"cageCount": 2}]}
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))
            with (
                patch.object(pdf_exports, "pdf_export_cache", cache),
                patch.object(
                    pdf_exports,
                    "render_quantity_sheet_pdf",
                    side_effect=lambda sheet: str(sheet["rows"][0]["cageCount"]).encode(),
                ),
            ):
                cache.invalidate([pdf_exports.quantity_pdf_cache_key(old)])
                # The first request already captured the old data but only now
                # reaches the cache. A later request must still see fresh data.
                self.assertEqual(pdf_exports._render_quantity_pdf(old), b"1")
                self.assertEqual(pdf_exports._render_quantity_pdf(fresh), b"2")
                self.assertEqual(pdf_exports._render_quantity_pdf(fresh), b"2")

    def test_split_layout_and_shared_calculation_changes_retire_old_render_code_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in ("pdf/quantity_document.py", "domains/billing/profiles.py", "shared/money_fields.py"):
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("old")
            previous = pdf_exports._render_code_fingerprint(root)
            for relative in ("pdf/quantity_document.py", "domains/billing/profiles.py", "shared/money_fields.py"):
                (root / relative).write_text("new")
                current = pdf_exports._render_code_fingerprint(root)
                self.assertNotEqual(previous, current)
                previous = current


if __name__ == "__main__":
    unittest.main()
