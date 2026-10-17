from fastapi import APIRouter

from app.agents import agent
from app.api.deps import block_or_404
from app.api.schemas import AgentRequest

router = APIRouter(tags=["agent"])


@router.post("/agent")
def post_agent(req: AgentRequest):
    return agent.plan(block_or_404(req.block_id), req.brief, req.budget_inr, req.years, unit_cost=req.unit_cost.as_dict() if req.unit_cost else None)
