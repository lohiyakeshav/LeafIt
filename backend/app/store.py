"""Persistence behind one small interface, so routers and agents never touch the filesystem directly.

File-backed today (ponytail): blocks ship in data/blocks, built areas are cached in data/areas, plans in data/plans.
Swapping to Firestore means re-implementing this class, nothing else (plan Phase 6).
"""
import json
import time
import uuid
from pathlib import Path

from .config import AREAS_DIR, BLOCKS_DIR
from .domain.sim import Block


def _safe(key: str) -> bool:
    return key.replace("_", "").isalnum()  # ids become file names: no slashes, dots or traversal


class FileStore:
    def __init__(self, blocks_dir: Path = BLOCKS_DIR, areas_dir: Path = AREAS_DIR, plans_dir: Path | None = None):
        self.blocks_dir, self.areas_dir = blocks_dir, areas_dir
        self.plans_dir = plans_dir or Path(__file__).parents[1] / "data/plans"
        self._cache: dict[str, Block] = {}
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

    def save_plan(self, plan: dict) -> str:
        self.plans_dir.mkdir(parents=True, exist_ok=True)
        pid = uuid.uuid4().hex[:8]
        (self.plans_dir / f"{pid}.json").write_text(json.dumps({**plan, "id": pid, "created": int(time.time())}))
        return pid

    def load_plan(self, pid: str) -> dict | None:
        p = self.plans_dir / f"{pid}.json"
        return json.loads(p.read_text()) if pid.isalnum() and p.exists() else None


store = FileStore()
