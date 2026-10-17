"""Blocks: sample areas shipped in data/blocks (real data, built by scripts/build_sample.py; read-only) and areas built from satellite data in data/areas.

Built areas are a cache that expires (config.AREA_TTL_DAYS): nothing in the app lists or reopens old ones.
"""
import json
import time
from pathlib import Path

from app import config
from app.config import AREAS_DIR, BLOCKS_DIR
from app.domain.sim import Block
from app.repositories.files import delete_older_than, safe_id


class BlockRepository:
    def __init__(self, blocks_dir: Path = BLOCKS_DIR, areas_dir: Path = AREAS_DIR):
        self.blocks_dir, self.areas_dir = blocks_dir, areas_dir
        self._cache: dict[str, Block] = {}
        self._last_purge = 0.0
        self.demo_ids = sorted(p.stem for p in blocks_dir.glob("*.json"))

    def _path(self, block_id: str) -> Path | None:
        if not safe_id(block_id):
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

    def get_raw_block(self, block_id: str) -> str | None:
        path = self._path(block_id)
        return path.read_text() if path else None

    def list_demo_blocks(self) -> list[Block]:
        return [self.get_block(block_id) for block_id in self.demo_ids]

    def save_area(self, block: dict) -> None:
        self.areas_dir.mkdir(parents=True, exist_ok=True)
        (self.areas_dir / f"{block['id']}.json").write_text(json.dumps(block, separators=(",", ":")))
        self._cache.pop(block["id"], None)
        if time.time() - self._last_purge > 3600:   # at most hourly: a directory scan per save would be wasteful
            self.purge_expired()

    def purge_expired(self, now: float | None = None) -> int:
        """Delete built areas older than their TTL (shipped sample blocks are never touched). Returns how many."""
        removed = delete_older_than(self.areas_dir, config.AREA_TTL_DAYS, now)
        for block_id in removed:
            self._cache.pop(block_id, None)
        self._last_purge = time.time()
        return len(removed)
