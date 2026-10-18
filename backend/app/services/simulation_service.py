"""Simulation use-cases: run the cooling model on a block, and publish its assumptions."""
from app.agents.checks import ASSUMPTION as CHECKS_ASSUMPTION
from app.domain.assumptions import ASSUMPTIONS
from app.domain.sim import Block, simulate
from app.services.block_service import BlockService
from app.services.errors import InvalidInputError


class SimulationService:
    def __init__(self, block_service: BlockService):
        self.block_service = block_service

    def simulate(self, block_id: str, placements: list[dict], years: int, unit_cost: dict | None = None) -> dict:
        return self.simulate_block(self.block_service.find_block(block_id), placements, years, unit_cost)

    def simulate_block(self, block: Block, placements: list[dict], years: int, unit_cost: dict | None = None) -> dict:
        try:
            return simulate(block, placements, years, unit_cost)
        except ValueError as e:   # e.g. a placement outside the grid
            raise InvalidInputError(str(e)) from e

    def get_assumptions(self) -> list[dict]:
        """The model's assumptions, then how the AI planner's plans are checked."""
        return [*ASSUMPTIONS, CHECKS_ASSUMPTION]
