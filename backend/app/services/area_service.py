"""Area use-cases: build-or-reuse an area for a drawn box, fetch it, and its live conditions."""
import asyncio

from app.domain.area.grid import Bounds, area_id, validate
from app.integrations import conditions
from app.integrations.earthengine import EEUnavailable
from app.repositories import BlockRepository
from app.services import area_builder
from app.services.errors import InvalidInputError, NotFoundError, UnavailableError


class AreaService:
    def __init__(self, blocks: BlockRepository):
        self.blocks = blocks
        self._building: dict[str, asyncio.Task] = {}  # one build per area at a time: double-clicks share the same work

    async def create_area(self, bounds: Bounds, name: str) -> dict:
        """-> {"id", "cached"}. Real data for a box never changes, so it is cached for good. A synthetic stand-in is
        never final: the next request retries the real data under the same id."""
        try:
            validate(bounds)
        except ValueError as e:
            raise InvalidInputError(str(e)) from e
        aid = area_id(bounds)
        cached = self.blocks.get_block(aid)
        if cached and not cached.meta.get("synthetic"):
            return {"id": aid, "cached": True}
        task = self._building.get(aid) or self._building.setdefault(aid, asyncio.ensure_future(area_builder.build_area(bounds, name)))
        try:
            block = await asyncio.shield(task)
        except EEUnavailable as e:
            raise UnavailableError(str(e)) from e
        finally:
            if task.done():
                self._building.pop(aid, None)
        self.blocks.save_area(block)
        return {"id": aid, "cached": False}

    def get_area(self, area_id: str) -> tuple[str, bool]:
        """-> (raw JSON, is synthetic)."""
        raw = self.blocks.get_raw_block(area_id)
        if raw is None:
            raise NotFoundError("unknown area")
        return raw, bool(self.blocks.get_block(area_id).meta.get("synthetic"))

    async def get_area_conditions(self, area_id: str) -> dict:
        """Air temperature and AQI right now at the area's centre."""
        block = self.blocks.get_block(area_id)
        if not block or block.meta.get("kind") != "area":
            raise NotFoundError("unknown area")
        b = block.meta["bounds"]
        return await conditions.fetch((b["north"] + b["south"]) / 2, (b["east"] + b["west"]) / 2)
