"""Runtime storage layout creation and one-time migration from the legacy data root."""

from __future__ import annotations

import json
import os
import shutil
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

LAYOUT_VERSION = 1
_LOCK = threading.Lock()


@dataclass(frozen=True)
class StorageLayoutPaths:
    root: Path
    database: Path
    pdf_cache: Path
    inspection_attachments: Path
    inspection_images: Path
    reimbursement_attachments: Path
    iacuc_index: Path
    db_is_overridden: bool = False
    pdf_cache_is_overridden: bool = False
    inspection_attachments_are_overridden: bool = False
    inspection_images_are_overridden: bool = False
    reimbursement_attachments_are_overridden: bool = False
    iacuc_index_is_overridden: bool = False

    @classmethod
    def from_config(cls) -> StorageLayoutPaths:
        from server_app import config

        return cls(
            root=config.DATA_ROOT,
            database=config.DB_PATH,
            pdf_cache=config.PDF_CACHE_PATH,
            inspection_attachments=config.ANIMAL_INSPECTION_ATTACHMENTS_PATH,
            inspection_images=config.ANIMAL_INSPECTION_IMAGES_PATH,
            reimbursement_attachments=config.REIMBURSEMENT_ATTACHMENTS_PATH,
            iacuc_index=config.IACUC_INDEX_PATH,
            db_is_overridden=_is_set("CAGELEDGER_DB"),
            pdf_cache_is_overridden=_is_set("CAGELEDGER_PDF_CACHE"),
            inspection_attachments_are_overridden=_is_set("CAGELEDGER_ANIMAL_INSPECTION_ATTACHMENTS"),
            inspection_images_are_overridden=_is_set("CAGELEDGER_ANIMAL_INSPECTION_IMAGES"),
            reimbursement_attachments_are_overridden=_is_set("CAGELEDGER_REIMBURSEMENT_ATTACHMENTS"),
            iacuc_index_is_overridden=_is_set("CAGELEDGER_IACUC_INDEX"),
        )


class StorageLayoutError(RuntimeError):
    pass


def ensure_storage_layout(paths: StorageLayoutPaths | None = None) -> None:
    """Create the canonical tree and migrate a prior flat ``data/`` tree once."""
    with _LOCK:
        layout = paths or StorageLayoutPaths.from_config()
        layout.root.mkdir(parents=True, exist_ok=True)
        _migrate_legacy_layout(layout)
        for path in _required_directories(layout):
            path.mkdir(parents=True, exist_ok=True)


def _migrate_legacy_layout(layout: StorageLayoutPaths) -> None:
    marker = layout.root / ".storage-layout-v1.json"
    if marker.exists():
        _clear_completed_rollback(layout, marker)
        return

    migrations = _legacy_migrations(layout)
    if not migrations:
        return
    for _source, target in migrations:
        if target.exists():
            raise StorageLayoutError(f"存储目录迁移冲突：目标已存在 {target}，请先检查数据后重试")

    migration_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    rollback_root = layout.root / "rollback" / f"storage-layout-v{LAYOUT_VERSION}-{migration_id}"
    moved: list[tuple[Path, Path]] = []
    try:
        for source, _target in migrations:
            backup = rollback_root / source.relative_to(layout.root)
            _copy_for_rollback(source, backup)
        for source, target in migrations:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(target))
            moved.append((source, target))
        marker.write_text(
            json.dumps(
                {
                    "version": LAYOUT_VERSION,
                    "migrationId": migration_id,
                    "status": "completed",
                    "rollbackPath": str(rollback_root.relative_to(layout.root)),
                    "completedAt": datetime.now(UTC).isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"[storage] migrated {len(migrations)} legacy data entries; rollback retained at {rollback_root}")
    except Exception as exc:
        for source, target in reversed(moved):
            if target.exists() and not source.exists():
                source.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(target), str(source))
        raise StorageLayoutError(f"存储目录迁移失败，已尝试恢复原位置：{exc}") from exc


def _legacy_migrations(layout: StorageLayoutPaths) -> list[tuple[Path, Path]]:
    root = layout.root
    entries: list[tuple[Path, Path]] = []
    if not layout.db_is_overridden:
        for suffix in ("", "-wal", "-shm"):
            source = root / f"cageledger.sqlite{suffix}"
            if source.exists():
                entries.append((source, layout.database.with_name(f"cageledger.sqlite{suffix}")))
    mappings = (
        (root / "pdf-cache", layout.pdf_cache, layout.pdf_cache_is_overridden),
        (root / "animal-inspection-images", layout.inspection_images, layout.inspection_images_are_overridden),
        (
            root / "animal-inspection-attachments",
            layout.inspection_attachments,
            layout.inspection_attachments_are_overridden,
        ),
        (
            root / "reimbursement-attachments",
            layout.reimbursement_attachments,
            layout.reimbursement_attachments_are_overridden,
        ),
        (root / "iacuc-index.json", layout.iacuc_index, layout.iacuc_index_is_overridden),
    )
    entries.extend((source, target) for source, target, overridden in mappings if source.exists() and not overridden)

    legacy_backups = root / "backups"
    canonical_backups = root / "backups" / "database"
    if legacy_backups.exists():
        for source in legacy_backups.iterdir():
            if source.name != "database":
                entries.append((source, canonical_backups / source.name))
    return entries


def _required_directories(layout: StorageLayoutPaths) -> tuple[Path, ...]:
    return (
        layout.database.parent,
        layout.pdf_cache,
        layout.inspection_attachments,
        layout.inspection_images,
        layout.reimbursement_attachments,
        layout.iacuc_index.parent,
        layout.root / "backups" / "database",
        layout.root / "inbox" / "iacuc",
        layout.root / "archive" / "iacuc",
        layout.root / "failed" / "iacuc",
    )


def _clear_completed_rollback(layout: StorageLayoutPaths, marker: Path) -> None:
    try:
        state = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    rollback = layout.root / state.get("rollbackPath", "")
    if state.get("status") == "completed" and rollback.is_dir():
        shutil.rmtree(rollback)
        print(f"[storage] removed confirmed rollback copy {rollback}")


def _copy_for_rollback(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(source, destination)
    else:
        shutil.copy2(source, destination)


def _is_set(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())
