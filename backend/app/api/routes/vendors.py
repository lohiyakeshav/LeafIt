from fastapi import APIRouter

from app.api.deps import VendorServiceDep
from app.api.schemas import QuoteRequest
from app.domain import market

router = APIRouter(tags=["vendors"])


@router.get("/vendors")
def list_vendors(block_id: str, service: VendorServiceDep, category: str | None = None, radius_km: float = market.SEARCH_RADIUS_KM):
    return service.list_vendors(block_id, set(category.split(",")) if category else None, radius_km)


@router.post("/quotes")
def create_quote(req: QuoteRequest, service: VendorServiceDep):
    return service.create_quote(req.plan_id, req.vendor_id)
