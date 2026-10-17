from fastapi import APIRouter, HTTPException, Response

from app.api.schemas import AreaIn
from app.domain.area.grid import Bounds, validate
from app.services import areas
from app.storage.store import store

router = APIRouter(tags=["areas"])


@router.post("/areas")
async def create_area(req: AreaIn):
    b = Bounds(**req.bounds.model_dump())
    try:
        validate(b)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    try:
        aid, cached = await areas.get_or_build(b, req.name or "Selected area")
    except areas.AreaUnavailable as e:
        raise HTTPException(503, str(e)) from e
    return {"id": aid, "cached": cached}


@router.get("/areas/{area_id}")
def get_area(area_id: str):
    raw = store.raw_block(area_id)
    if raw is None:
        raise HTTPException(404, "unknown area")
    # real satellite data for a given id never changes, so the browser may keep it forever; a synthetic stand-in may be
    # replaced by the real thing later under the same id, so it must be revalidated
    cache = "no-cache" if store.get_block(area_id).meta.get("synthetic") else "public, max-age=31536000, immutable"
    return Response(raw, media_type="application/json", headers={"Cache-Control": cache})


@router.get("/areas/{area_id}/conditions")
async def get_conditions(area_id: str):
    block = store.get_block(area_id)
    if not block or block.meta.get("kind") != "area":
        raise HTTPException(404, "unknown area")
    return await areas.live_conditions(block)
