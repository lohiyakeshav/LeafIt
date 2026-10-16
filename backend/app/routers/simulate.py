from fastapi import APIRouter

from ..deps import block_or_404, run_sim
from ..domain.sim import ASSUMPTIONS
from ..schemas import SimRequest

router = APIRouter(tags=["simulate"])


@router.post("/simulate")
def post_simulate(req: SimRequest):
    return run_sim(block_or_404(req.block_id), [p.model_dump() for p in req.placements], req.years)


@router.get("/assumptions")
def assumptions():
    return ASSUMPTIONS
