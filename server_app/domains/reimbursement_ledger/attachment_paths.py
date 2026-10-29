"""Constrain claim attachment paths, including paths from older databases."""

from pathlib import Path


def _component(value):
    if not isinstance(value, str) or not value or value in {".", ".."} or any(c in value for c in ("/", "\\", "\x00")):
        raise LookupError("报销单附件路径无效，请联系管理员核对")
    return value


def claim_directory(root, claim_id):
    _component(claim_id)
    if claim_id.casefold() == "workflows":
        raise LookupError("报销单附件路径无效，请联系管理员核对")
    try:
        root = Path(root).resolve()
        directory = root / claim_id
        # A claim directory must be exclusively its own, even if a symlink
        # points at another directory that is still under the same root.
        if directory.is_symlink() or directory.resolve().parent != root:
            raise LookupError("报销单附件路径无效，请联系管理员核对")
        return directory
    except (OSError, RuntimeError):
        raise LookupError("报销单附件路径无效，请联系管理员核对") from None


def attachment_path(root, claim_id, stored_name):
    directory = claim_directory(root, claim_id)
    _component(stored_name)
    target = directory / stored_name
    try:
        if target.resolve().parent != directory:
            raise LookupError("报销单附件路径无效，请联系管理员核对")
    except (OSError, RuntimeError):
        raise LookupError("报销单附件路径无效，请联系管理员核对") from None
    return target
