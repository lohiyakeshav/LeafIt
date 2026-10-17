"""Area use-cases: build-or-reuse an area for a drawn box, and its live conditions. The API layer only calls these."""
import asyncio

from app.domain.area.grid import Bounds, area_id
from app.domain.sim import Block
from app.integrations import conditions
from app.integrations.earthengine import EEUnavailable as AreaUnavailable  # noqa: F401 - re-exported for the API layer
from app.services import area_builder
from app.storage.store import store

_building: dict[str, asyncio.Task] = {}  # one build per area at a time: double-clicks share the same work


async def get_or_build(bounds: Bounds, name: str) -> tuple[str, bool]:
    """-> (area id, served from cache). Raises AreaUnavailable when the satellite service is down (and no stand-in is allowed).

    Real data for a box never changes, so it is cached for good. A synthetic stand-in is never final: the next request
    retries the real data under the same id.
    """
    aid = area_id(bounds)
    cached = store.get_block(aid)
    if cached and not cached.meta.get("synthetic"):
        return aid, True
    task = _building.get(aid) or _building.setdefault(aid, asyncio.ensure_future(area_builder.build_area(bounds, name)))
    try:
        block = await asyncio.shield(task)
    finally:
        if task.done():
            _building.pop(aid, None)
    store.put_area(block)
    return aid, False


async def live_conditions(block: Block) -> dict:
    """Air temperature and AQI right now at the area's centre."""
    b = block.meta["bounds"]
    return await conditions.fetch((b["north"] + b["south"]) / 2, (b["east"] + b["west"]) / 2)
