"""AI planner use-case: turn a brief and a budget into a recommended plan."""
from app.agents import agent
from app.domain.sim import prices
from app.services.block_service import BlockService
from app.services.errors import InvalidInputError, UnavailableError


class AgentService:
    def __init__(self, block_service: BlockService):
        self.block_service = block_service

    def plan_with_agent(self, block_id: str, brief: str, budget_inr: float, years: int, unit_cost: dict | None = None) -> dict:
        tree = prices(unit_cost)["tree"]
        if budget_inr < tree:   # nothing could be planted: say so instead of asking Gemini to plan with no money
            raise InvalidInputError(f"A budget of ₹{budget_inr:,.0f} can't pay for a single tree (₹{tree:,.0f} each). Raise the budget to plan.")
        try:
            return agent.plan(self.block_service.find_block(block_id), brief, budget_inr, years, unit_cost=unit_cost)
        except agent.PlannerUnavailable as e:
            raise UnavailableError(str(e)) from e
