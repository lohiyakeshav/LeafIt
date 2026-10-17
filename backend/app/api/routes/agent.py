from fastapi import APIRouter

from app.api.deps import AgentServiceDep
from app.api.schemas import AgentRequest

router = APIRouter(tags=["agent"])


@router.post("/agent")
def plan_with_agent(req: AgentRequest, service: AgentServiceDep):
    uc = req.unit_cost.as_dict() if req.unit_cost else None
    return service.plan_with_agent(req.block_id, req.brief, req.budget_inr, req.years, uc)
