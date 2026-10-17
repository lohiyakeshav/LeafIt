from fastapi import APIRouter

from app.api.deps import SimulationServiceDep
from app.api.schemas import SimRequest

router = APIRouter(tags=["simulate"])


@router.post("/simulate")
def simulate(req: SimRequest, service: SimulationServiceDep):
    uc = req.unit_cost.as_dict() if req.unit_cost else None
    return service.simulate(req.block_id, [p.model_dump(exclude_none=True) for p in req.placements], req.years, uc)


@router.get("/assumptions")
def get_assumptions(service: SimulationServiceDep):
    return service.get_assumptions()
