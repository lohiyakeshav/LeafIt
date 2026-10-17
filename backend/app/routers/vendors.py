from fastapi import APIRouter, HTTPException

from ..deps import block_or_404, plan_or_404
from ..domain import market
from ..schemas import QuoteRequest

router = APIRouter(tags=["vendors"])


@router.get("/vendors")
def vendors(block_id: str, category: str | None = None, radius_km: float = market.SEARCH_RADIUS_KM):
    cats = set(category.split(",")) if category else None
    return market.find_vendors(market.center(block_or_404(block_id)), cats, radius_km)


@router.post("/quotes")
def quotes(req: QuoteRequest):
    plan = plan_or_404(req.plan_id)
    vendor = next((v for v in market.VENDORS if v["id"] == req.vendor_id), None)
    if not vendor:
        raise HTTPException(404, "unknown vendor")
    block = block_or_404(plan["block_id"])
    return market.quote_links(plan, block, market.bom(block, plan["placements"]), vendor)
