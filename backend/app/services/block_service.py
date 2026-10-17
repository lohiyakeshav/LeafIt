"""Block use-cases: list the sample blocks, fetch one. Also the shared "find a block or raise" other services use."""
from app.domain.sim import Block
from app.repositories import BlockRepository
from app.services.errors import NotFoundError


class BlockService:
    def __init__(self, blocks: BlockRepository):
        self.blocks = blocks

    def list_blocks(self) -> list[dict]:
        return [{k: b.meta[k] for k in ("id", "name", "origin", "sample") if k in b.meta}
                for b in self.blocks.list_demo_blocks()]

    def get_block(self, block_id: str) -> str:
        """The block's raw cached JSON (sent as-is: re-serialising it would be wasted work)."""
        raw = self.blocks.get_raw_block(block_id)
        if raw is None:
            raise NotFoundError("unknown block")
        return raw

    def find_block(self, block_id: str) -> Block:
        block = self.blocks.get_block(block_id)
        if not block:
            raise NotFoundError("unknown block")
        return block
