from fastapi import APIRouter, Response

from app.api.deps import AreaServiceDep
from app.api.schemas import AreaIn
from app.domain.area.grid import Bounds

router = APIRouter(tags=["areas"])


@router.post("/areas")
async def create_area(req: AreaIn, service: AreaServiceDep):
    return await service.create_area(Bounds(**req.bounds.model_dump()), req.name or "Selected area")


@router.get("/areas/{area_id}")
def get_area(area_id: str, service: AreaServiceDep):
    raw, synthetic = service.get_area(area_id)
    # real satellite data for a given id never changes, so the browser may keep it forever; a synthetic stand-in may be
    # replaced by the real thing later under the same id, so it must be revalidated
    cache = "no-cache" if synthetic else "public, max-age=31536000, immutable"
    return Response(raw, media_type="application/json", headers={"Cache-Control": cache})


@router.get("/areas/{area_id}/conditions")
async def get_area_conditions(area_id: str, service: AreaServiceDep):
    return await service.get_area_conditions(area_id)
