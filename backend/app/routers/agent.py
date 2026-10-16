from fastapi import APIRouter

from ..agents import agent
from ..deps import block_or_404
from ..schemas import AgentRequest

router = APIRouter(tags=["agent"])


@router.post("/agent")
def post_agent(req: AgentRequest):
    return agent.plan(block_or_404(req.block_id), req.brief, req.budget_inr, req.years)
