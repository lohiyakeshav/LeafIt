"""Persistence behind one small interface, so the rest of the app never touches the filesystem directly.

File-backed today: sample blocks ship in data/blocks; built areas (data/areas) and saved plans (data/plans) are a
cache that expires (config.AREA_TTL_DAYS / PLAN_TTL_DAYS), because nothing in the app lists or reopens old ones.
Swapping to Firestore or GCS means re-implementing this class, nothing else.
"""
import json
import time
import uuid
from pathlib import Path

from app import config
from app.config import AREAS_DIR, BLOCKS_DIR, PLANS_DIR, VENDORS_FILE
from app.domain.sim import Block


def _safe(key: str) -> bool:
    return key.replace("_", "").isalnum()  # ids become file names: no slashes, dots or traversal


class FileStore:
    def __init__(self, blocks_dir: Path = BLOCKS_DIR, areas_dir: Path = AREAS_DIR, plans_dir: Path | None = None):
        self.blocks_dir, self.areas_dir = blocks_dir, areas_dir
        self.plans_dir = plans_dir or PLANS_DIR
        self._cache: dict[str, Block] = {}
        self._vendors: list[dict] | None = None
        self._last_purge = 0.0
        self.demo_ids = sorted(p.stem for p in blocks_dir.glob("*.json"))

    def _path(self, block_id: str) -> Path | None:
        if not _safe(block_id):
            return None
        for folder in (self.blocks_dir, self.areas_dir):
            p = folder / f"{block_id}.json"
            if p.exists():
                return p
        return None

    def get_block(self, block_id: str) -> Block | None:
        if block_id not in self._cache:
            path = self._path(block_id)
            if not path:
                return None
            self._cache[block_id] = Block.load(path)
        return self._cache[block_id]

    def raw_block(self, block_id: str) -> str | None:
        path = self._path(block_id)
        return path.read_text() if path else None

    def list_blocks(self) -> list[dict]:
        out = []
        for block_id in self.demo_ids:
            b = self.get_block(block_id)
            out.append({k: b.meta[k] for k in ("id", "name", "origin", "synthetic") if k in b.meta})
        return out

    def put_area(self, block: dict) -> None:
        self.areas_dir.mkdir(parents=True, exist_ok=True)
        (self.areas_dir / f"{block['id']}.json").write_text(json.dumps(block, separators=(",", ":")))
        self._cache.pop(block["id"], None)
        self._purge_now_and_then()

    def save_plan(self, plan: dict) -> str:
        self.plans_dir.mkdir(parents=True, exist_ok=True)
        pid = uuid.uuid4().hex[:8]
        (self.plans_dir / f"{pid}.json").write_text(json.dumps({**plan, "id": pid, "created": int(time.time())}))
        self._purge_now_and_then()
        return pid

    def purge_expired(self, now: float | None = None) -> int:
        """Delete saved plans and built areas older than their TTL. Returns how many files were removed."""
        now = time.time() if now is None else now
        removed = 0
        for folder, days in ((self.plans_dir, config.PLAN_TTL_DAYS), (self.areas_dir, config.AREA_TTL_DAYS)):
            for f in folder.glob("*.json") if folder.is_dir() else ():
                if now - f.stat().st_mtime > days * 86_400:
                    f.unlink(missing_ok=True)
                    self._cache.pop(f.stem, None)
                    removed += 1
        self._last_purge = now
        return removed

    def _purge_now_and_then(self) -> None:
        if time.time() - self._last_purge > 3600:   # at most hourly: a directory scan per save would be wasteful
            self.purge_expired()

    def vendors(self) -> list[dict]:
        """The supplier directory (sample listings today; Places-backed later)."""
        if self._vendors is None:
            self._vendors = json.loads(VENDORS_FILE.read_text())
        return self._vendors

    def vendor(self, vendor_id: str) -> dict | None:
        return next((v for v in self.vendors() if v["id"] == vendor_id), None)

    def load_plan(self, pid: str) -> dict | None:
        p = self.plans_dir / f"{pid}.json"
        return json.loads(p.read_text()) if pid.isalnum() and p.exists() else None


store = FileStore()
