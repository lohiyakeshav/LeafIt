from fastapi import APIRouter

from app.api.deps import block_or_404, run_sim
from app.api.schemas import SimRequest
from app.domain.sim import ASSUMPTIONS

router = APIRouter(tags=["simulate"])


@router.post("/simulate")
def post_simulate(req: SimRequest):
    uc = req.unit_cost.as_dict() if req.unit_cost else None
    return run_sim(block_or_404(req.block_id), [p.model_dump() for p in req.placements], req.years, uc)


@router.get("/assumptions")
def assumptions():
    return ASSUMPTIONS
