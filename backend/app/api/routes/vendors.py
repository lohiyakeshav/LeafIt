from fastapi import APIRouter, HTTPException

from app.api.deps import block_or_404, plan_or_404
from app.api.schemas import QuoteRequest
from app.domain import market
from app.storage.store import store

router = APIRouter(tags=["vendors"])


@router.get("/vendors")
def vendors(block_id: str, category: str | None = None, radius_km: float = market.SEARCH_RADIUS_KM):
    cats = set(category.split(",")) if category else None
    return market.find_vendors(store.vendors(), market.center(block_or_404(block_id)), cats, radius_km)


@router.post("/quotes")
def quotes(req: QuoteRequest):
    plan = plan_or_404(req.plan_id)
    vendor = store.vendor(req.vendor_id)
    if not vendor:
        raise HTTPException(404, "unknown vendor")
    block = block_or_404(plan["block_id"])
    return market.quote_links(plan, block, market.bom(block, plan["placements"]), vendor)
