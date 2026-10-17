"""Small helpers shared by routers: look-ups that turn "not found" / "invalid plan" into the right HTTP errors."""
from fastapi import HTTPException

from app.domain.sim import Block, simulate
from app.storage.store import store


def block_or_404(block_id: str) -> Block:
    block = store.get_block(block_id)
    if not block:
        raise HTTPException(404, "unknown block")
    return block


def plan_or_404(pid: str) -> dict:
    plan = store.load_plan(pid)
    if not plan:
        raise HTTPException(404, "unknown plan")
    return plan


def run_sim(block: Block, placements: list[dict], years: int, unit_cost: dict | None = None) -> dict:
    try:
        return simulate(block, placements, years, unit_cost)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
