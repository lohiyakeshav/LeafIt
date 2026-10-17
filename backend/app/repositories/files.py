"""File helpers shared by the repositories."""
import time
from pathlib import Path


def safe_id(key: str) -> bool:
    return key.replace("_", "").isalnum()  # ids become file names: no slashes, dots or traversal


def delete_older_than(folder: Path, days: float, now: float | None = None) -> list[str]:
    """Delete *.json files in `folder` older than `days`. Returns the ids (file stems) removed."""
    now = time.time() if now is None else now
    removed = []
    for f in folder.glob("*.json") if folder.is_dir() else ():
        if now - f.stat().st_mtime > days * 86_400:
            f.unlink(missing_ok=True)
            removed.append(f.stem)
    return removed
