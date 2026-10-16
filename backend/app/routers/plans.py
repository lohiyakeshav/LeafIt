from fastapi import APIRouter

from ..agents import proposal
from ..deps import block_or_404, plan_or_404, run_sim
from ..domain import market
from ..schemas import PlanIn
from ..store import store

router = APIRouter(tags=["plans"])


@router.post("/plans")
def create_plan(req: PlanIn):
    run_sim(block_or_404(req.block_id), [p.model_dump() for p in req.placements], req.years)  # validate before saving
    return {"id": store.save_plan({**req.model_dump(), "name": req.name or "Untitled plan"})}


@router.get("/plans/{pid}")
def get_plan(pid: str):
    plan = plan_or_404(pid)
    return {**plan, "metrics": run_sim(block_or_404(plan["block_id"]), plan["placements"], plan["years"])["metrics"]}


@router.get("/plans/{pid}/bom")
def get_bom(pid: str):
    plan = plan_or_404(pid)
    return market.bom(block_or_404(plan["block_id"]), plan["placements"])


@router.post("/plans/{pid}/proposal")
def post_proposal(pid: str):
    plan = plan_or_404(pid)
    block = block_or_404(plan["block_id"])
    ctx = {"block": block.meta["name"], "plan_name": plan["name"], "years": plan["years"],
           "metrics": run_sim(block, plan["placements"], plan["years"])["metrics"],
           "bill_of_materials": market.bom(block, plan["placements"])}
    return proposal.write(ctx)
