"""Runtime reference images for the animal inspection catalog."""

from pathlib import Path

ALLOWED_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def ensure_seed_images(images_root, seed_root):
    """Idempotently copy seed reference images into the runtime data directory."""
    images_root.mkdir(parents=True, exist_ok=True)
    copied = 0
    for source in sorted(Path(seed_root).glob("*")):
        if not source.is_file() or source.suffix.lower() not in ALLOWED_IMAGE_EXTENSIONS:
            continue
        target = Path(images_root) / source.name
        if target.is_file():
            continue
        target.write_bytes(source.read_bytes())
        copied += 1
    return copied


def save_reference_image(images_root, filename, body):
    """Validate and persist an uploaded reference image; returns the stored filename."""
    name = validated_filename(filename)
    root = Path(images_root)
    root.mkdir(parents=True, exist_ok=True)
    target = root / name
    if target.exists():
        stem, suffix = name.rsplit(".", 1)
        counter = 1
        while (root / f"{stem}-{counter}.{suffix}").exists():
            counter += 1
        name = f"{stem}-{counter}.{suffix}"
        target = root / name
    target.write_bytes(body)
    return name


def validated_filename(filename):
    """Return a safe image filename or raise ValueError."""
    name = Path(str(filename or "")).name
    if not name or name in {".", ".."}:
        raise ValueError("文件名不合法")
    if Path(name).suffix.lower() not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValueError("只支持 jpg、png、webp 图片")
    return name


def image_size_error(body):
    """Return an error message when the body exceeds the size limit."""
    if len(body) > MAX_IMAGE_BYTES:
        return "图片不能超过 5MB"
    return ""
