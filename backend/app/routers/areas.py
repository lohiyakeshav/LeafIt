import asyncio

from fastapi import APIRouter, HTTPException, Response

from ..geodata import area_builder, conditions
from ..geodata.earthengine import EEUnavailable
from ..geodata.grid import Bounds, area_id, validate
from ..schemas import AreaIn
from ..store import store

router = APIRouter(tags=["areas"])
_building: dict[str, asyncio.Task] = {}  # one build per area at a time: double-clicks share the same work


@router.post("/areas")
async def create_area(req: AreaIn):
    b = Bounds(**req.bounds.model_dump())
    try:
        validate(b)
    except ValueError as e:
        raise HTTPException(422, str(e))
    aid = area_id(b)
    cached = store.get_block(aid)
    if cached and not cached.meta.get("synthetic"):   # a synthetic stand-in is never final: retry the real data next time
        return {"id": aid, "cached": True}
    task = _building.get(aid) or _building.setdefault(aid, asyncio.ensure_future(area_builder.build_area(b, req.name or "Selected area")))
    try:
        block = await asyncio.shield(task)
    except EEUnavailable as e:
        raise HTTPException(503, str(e))
    finally:
        if task.done():
            _building.pop(aid, None)
    store.put_area(block)
    return {"id": aid, "cached": False}


@router.get("/areas/{area_id}")
def get_area(area_id: str):
    raw = store.raw_block(area_id)
    if raw is None:
        raise HTTPException(404, "unknown area")
    # real satellite data for a given id never changes, so the browser may keep it forever; a synthetic stand-in may be
    # replaced by the real thing later under the same id, so it must be revalidated
    block = store.get_block(area_id)
    cache = "no-cache" if block.meta.get("synthetic") else "public, max-age=31536000, immutable"
    return Response(raw, media_type="application/json", headers={"Cache-Control": cache})


@router.get("/areas/{area_id}/conditions")
async def get_conditions(area_id: str):
    block = store.get_block(area_id)
    if not block or block.meta.get("kind") != "area":
        raise HTTPException(404, "unknown area")
    b = block.meta["bounds"]
    return await conditions.fetch((b["north"] + b["south"]) / 2, (b["east"] + b["west"]) / 2)
