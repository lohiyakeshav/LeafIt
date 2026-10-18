"""Vendor use-cases: real businesses near a block (Places), and ready-to-send quote requests for a plan."""
from app.domain import market
from app.integrations import vendors as vendor_search
from app.services.block_service import BlockService
from app.services.errors import NotFoundError
from app.services.plan_service import PlanService


class VendorService:
    def __init__(self, block_service: BlockService, plan_service: PlanService):
        self.block_service = block_service
        self.plan_service = plan_service

    def list_vendors(self, block_id: str, categories: set[str] | None, radius_km: float | None = None) -> dict:
        """`available` is false without a server key, so the page can say why it's empty."""
        near = market.center(self.block_service.find_block(block_id))
        cats = [c for c in (categories or vendor_search.QUERIES) if c in vendor_search.QUERIES]
        found = [v for c in cats for v in vendor_search.search(c, *near)]
        return {"available": vendor_search.available(), "vendors": market.find_vendors(found, near, set(cats), radius_km or market.SEARCH_RADIUS_KM)}

    def create_quote(self, plan_id: str, vendor_id: str) -> dict:
        plan = self.plan_service.find_plan(plan_id)
        vendor = vendor_search.get(vendor_id)
        if not vendor:
            raise NotFoundError("unknown vendor")
        block = self.block_service.find_block(plan["block_id"])
        return market.quote_links(plan, block, market.bom(block, plan["placements"]), vendor)
