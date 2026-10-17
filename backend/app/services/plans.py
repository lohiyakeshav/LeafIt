"""Plan use-cases that combine the simulator, the bill of materials and the AI writer."""
from app.agents import proposal
from app.domain import market
from app.domain.sim import Block, prices, simulate
from app.services import fx


async def write_proposal(block: Block, plan: dict, currency_code: str = "INR") -> dict:
    """Funding proposal for a saved plan, with money in the reader's currency (maths stays in INR)."""
    ctx = {
        "block": block.meta["name"], "plan_name": plan["name"], "years": plan["years"],
        "metrics": simulate(block, plan["placements"], plan["years"], plan.get("unit_cost"))["metrics"],
        "unit_prices_inr": prices(plan.get("unit_cost")),
        "currency": await fx.currency(currency_code),
        "bill_of_materials": market.bom(block, plan["placements"]),
    }
    return proposal.write(ctx)
