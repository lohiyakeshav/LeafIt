"""Vendor use-cases: suppliers near a block, and ready-to-send quote requests for a plan."""
from app.domain import market
from app.repositories import VendorRepository
from app.services.block_service import BlockService
from app.services.errors import NotFoundError
from app.services.plan_service import PlanService


class VendorService:
    def __init__(self, vendors: VendorRepository, block_service: BlockService, plan_service: PlanService):
        self.vendors = vendors
        self.block_service = block_service
        self.plan_service = plan_service

    def list_vendors(self, block_id: str, categories: set[str] | None, radius_km: float) -> list[dict]:
        block = self.block_service.find_block(block_id)
        return market.find_vendors(self.vendors.list_vendors(), market.center(block), categories, radius_km)

    def create_quote(self, plan_id: str, vendor_id: str) -> dict:
        plan = self.plan_service.find_plan(plan_id)
        vendor = self.vendors.get_vendor(vendor_id)
        if not vendor:
            raise NotFoundError("unknown vendor")
        block = self.block_service.find_block(plan["block_id"])
        return market.quote_links(plan, block, market.bom(block, plan["placements"]), vendor)
