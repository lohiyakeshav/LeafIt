from fastapi import APIRouter

from app.api.deps import PlanServiceDep
from app.api.schemas import PlanIn, ProposalIn

router = APIRouter(tags=["plans"])


@router.post("/plans")
def create_plan(req: PlanIn, service: PlanServiceDep):
    uc = req.unit_cost.as_dict() if req.unit_cost else None
    return service.create_plan(req.block_id, [p.model_dump(exclude_none=True) for p in req.placements], req.years, req.name, uc)


@router.get("/plans/{pid}")
def get_plan(pid: str, service: PlanServiceDep):
    return service.get_plan(pid)


@router.get("/plans/{pid}/bom")
def get_plan_bom(pid: str, service: PlanServiceDep):
    return service.get_plan_bom(pid)


@router.post("/plans/{pid}/proposal")
async def create_plan_proposal(pid: str, service: PlanServiceDep, req: ProposalIn | None = None):
    return await service.create_plan_proposal(pid, req.currency if req else "INR")
