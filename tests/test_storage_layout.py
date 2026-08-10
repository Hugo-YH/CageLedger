import json
import tempfile
import unittest
from pathlib import Path

from server_app.storage_layout import StorageLayoutPaths, ensure_storage_layout


def layout_for(root: Path) -> StorageLayoutPaths:
    return StorageLayoutPaths(
        root=root,
        database=root / "database" / "cageledger.sqlite",
        pdf_cache=root / "cache" / "pdf",
        inspection_attachments=root / "files" / "animal-inspections" / "attachments",
        inspection_images=root / "files" / "animal-inspections" / "reference-images",
        reimbursement_attachments=root / "files" / "reimbursements" / "attachments",
        iacuc_index=root / "indexes" / "iacuc" / "index.json",
    )


class StorageLayoutTests(unittest.TestCase):
    def test_migrates_flat_legacy_data_and_keeps_one_rollback_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "cageledger.sqlite").write_text("database", encoding="utf-8")
            (root / "cageledger.sqlite-wal").write_text("wal", encoding="utf-8")
            (root / "iacuc-index.json").write_text(json.dumps([{"iacuc": "I-1"}]), encoding="utf-8")
            (root / "animal-inspection-images").mkdir()
            (root / "animal-inspection-images" / "reference.png").write_bytes(b"image")
            (root / "animal-inspection-attachments" / "inspect-1").mkdir(parents=True)
            (root / "animal-inspection-attachments" / "inspect-1" / "photo.jpg").write_bytes(b"photo")
            (root / "reimbursement-attachments" / "claim-1").mkdir(parents=True)
            (root / "reimbursement-attachments" / "claim-1" / "receipt.pdf").write_bytes(b"receipt")
            (root / "pdf-cache" / "artifacts").mkdir(parents=True)
            (root / "pdf-cache" / "artifacts" / "sheet.pdf").write_bytes(b"pdf")
            (root / "backups").mkdir()
            (root / "backups" / "before.sqlite").write_bytes(b"backup")

            layout = layout_for(root)
            ensure_storage_layout(layout)

            self.assertEqual(layout.database.read_text(encoding="utf-8"), "database")
            self.assertEqual(layout.database.with_name("cageledger.sqlite-wal").read_text(encoding="utf-8"), "wal")
            self.assertTrue((layout.iacuc_index).is_file())
            self.assertTrue((layout.inspection_images / "reference.png").is_file())
            self.assertTrue((layout.inspection_attachments / "inspect-1" / "photo.jpg").is_file())
            self.assertTrue((layout.reimbursement_attachments / "claim-1" / "receipt.pdf").is_file())
            self.assertTrue((layout.pdf_cache / "artifacts" / "sheet.pdf").is_file())
            self.assertTrue((root / "backups" / "database" / "before.sqlite").is_file())
            marker = json.loads((root / ".storage-layout-v1.json").read_text(encoding="utf-8"))
            rollback = root / marker["rollbackPath"]
            self.assertTrue((rollback / "cageledger.sqlite").is_file())

            ensure_storage_layout(layout)
            self.assertFalse(rollback.exists())

    def test_creates_empty_canonical_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            layout = layout_for(root)
            ensure_storage_layout(layout)

            for path in (
                layout.database.parent,
                layout.pdf_cache,
                layout.inspection_attachments,
                layout.inspection_images,
                layout.reimbursement_attachments,
                layout.iacuc_index.parent,
                root / "backups" / "database",
                root / "inbox" / "iacuc",
                root / "archive" / "iacuc",
                root / "failed" / "iacuc",
            ):
                self.assertTrue(path.is_dir(), path)


if __name__ == "__main__":
    unittest.main()
