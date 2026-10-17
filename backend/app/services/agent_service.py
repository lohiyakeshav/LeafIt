"""AI planner use-case: turn a brief and a budget into a recommended plan."""
from app.agents import agent
from app.services.block_service import BlockService


class AgentService:
    def __init__(self, block_service: BlockService):
        self.block_service = block_service

    def plan_with_agent(self, block_id: str, brief: str, budget_inr: float, years: int, unit_cost: dict | None = None) -> dict:
        return agent.plan(self.block_service.find_block(block_id), brief, budget_inr, years, unit_cost=unit_cost)
