from fastapi import APIRouter

from app.api.deps import block_or_404, plan_or_404, run_sim
from app.api.schemas import PlanIn, ProposalIn
from app.domain import market
from app.services import plans
from app.storage.store import store

router = APIRouter(tags=["plans"])


@router.post("/plans")
def create_plan(req: PlanIn):
    uc = req.unit_cost.as_dict() if req.unit_cost else None
    run_sim(block_or_404(req.block_id), [p.model_dump() for p in req.placements], req.years, uc)  # validate before saving
    # the plan keeps the prices it was costed with, so its BOM, proposal and metrics stay consistent later
    return {"id": store.save_plan({**req.model_dump(exclude={"unit_cost"}), "unit_cost": uc, "name": req.name or "Untitled plan"})}


@router.get("/plans/{pid}")
def get_plan(pid: str):
    plan = plan_or_404(pid)
    return {**plan, "metrics": run_sim(block_or_404(plan["block_id"]), plan["placements"], plan["years"], plan.get("unit_cost"))["metrics"]}


@router.get("/plans/{pid}/bom")
def get_bom(pid: str):
    plan = plan_or_404(pid)
    return market.bom(block_or_404(plan["block_id"]), plan["placements"])


@router.post("/plans/{pid}/proposal")
async def post_proposal(pid: str, req: ProposalIn | None = None):
    plan = plan_or_404(pid)
    return await plans.write_proposal(block_or_404(plan["block_id"]), plan, req.currency if req else "INR")
