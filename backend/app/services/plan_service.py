"""Plan use-cases: save a plan, read it back with fresh metrics, its bill of materials, and a funding proposal."""
from starlette.concurrency import run_in_threadpool

from app.agents import context, proposal
from app.domain import market
from app.domain.sim import Block, prices
from app.repositories import PlanRepository
from app.services.block_service import BlockService
from app.services.errors import NotFoundError
from app.services.fx_service import FxService
from app.services.simulation_service import SimulationService


class PlanService:
    def __init__(self, plans: PlanRepository, block_service: BlockService, simulation_service: SimulationService, fx_service: FxService):
        self.plans = plans
        self.block_service = block_service
        self.simulation_service = simulation_service
        self.fx_service = fx_service

    def create_plan(self, block_id: str, placements: list[dict], years: int, name: str, unit_cost: dict | None = None) -> dict:
        self.simulation_service.simulate(block_id, placements, years, unit_cost)  # validate before saving
        # the plan keeps the prices it was costed with, so its BOM, proposal and metrics stay consistent later
        pid = self.plans.save_plan({"block_id": block_id, "placements": placements, "years": years, "name": name or "Untitled plan", "unit_cost": unit_cost})
        return {"id": pid}

    def get_plan(self, pid: str) -> dict:
        plan = self.find_plan(pid)
        metrics = self.simulation_service.simulate(plan["block_id"], plan["placements"], plan["years"], plan.get("unit_cost"))["metrics"]
        return {**plan, "metrics": metrics}

    def get_plan_bom(self, pid: str) -> list[dict]:
        plan = self.find_plan(pid)
        return market.bom(self.block_service.find_block(plan["block_id"]), plan["placements"])

    async def create_plan_proposal(self, pid: str, currency_code: str = "INR") -> dict:
        """Funding proposal for a saved plan, with money in the reader's currency (maths stays in INR)."""
        plan = self.find_plan(pid)
        block = self.block_service.find_block(plan["block_id"])
        ctx = {
            "block": block.meta["name"], "plan_name": plan["name"], "years": plan["years"],
            "metrics": self.simulation_service.simulate_block(block, plan["placements"], plan["years"], plan.get("unit_cost"))["metrics"],
            "unit_prices_inr": prices(plan.get("unit_cost")),
            "currency": await self.fx_service.get_currency(currency_code),
            "bill_of_materials": market.bom(block, plan["placements"]),
            "place": _place(block),
        }
        return await run_in_threadpool(proposal.write, ctx)   # the Gemini SDK call blocks: keep it off the event loop

    def find_plan(self, pid: str) -> dict:
        plan = self.plans.get_plan(pid)
        if not plan:
            raise NotFoundError("unknown plan")
        return plan


def _place(block: Block) -> dict:
    """The few facts about the place a funding proposal should rest on."""
    b = context.place_brief(block, 0, 10)
    out = {"climate_class": b["place"]["climate_class"], "area_ha": b["place"]["area_ha"], "existing_canopy_pct": b["land"]["existing_canopy_pct"]}
    if "people" in b:
        out.update(residents=b["people"]["residents"], vulnerable_residents=b["people"]["vulnerable_residents"])
    return out
