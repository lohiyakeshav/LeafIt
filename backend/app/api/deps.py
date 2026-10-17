"""Composition root: builds the repositories and services once, and exposes each service to routes via Depends.

Tests (or a future Firestore build) swap an implementation here or with app.dependency_overrides.
"""
from typing import Annotated

from fastapi import Depends

from app.repositories import BlockRepository, FxRateRepository, PlanRepository, VendorRepository
from app.services.agent_service import AgentService
from app.services.area_service import AreaService
from app.services.block_service import BlockService
from app.services.fx_service import FxService
from app.services.plan_service import PlanService
from app.services.simulation_service import SimulationService
from app.services.vendor_service import VendorService

block_repository = BlockRepository()
plan_repository = PlanRepository()
vendor_repository = VendorRepository()
fx_repository = FxRateRepository()

block_service = BlockService(block_repository)
area_service = AreaService(block_repository)
simulation_service = SimulationService(block_service)
agent_service = AgentService(block_service)
fx_service = FxService(fx_repository)
plan_service = PlanService(plan_repository, block_service, simulation_service, fx_service)
vendor_service = VendorService(vendor_repository, block_service, plan_service)


def get_block_service() -> BlockService:
    return block_service


def get_area_service() -> AreaService:
    return area_service


def get_simulation_service() -> SimulationService:
    return simulation_service


def get_agent_service() -> AgentService:
    return agent_service


def get_plan_service() -> PlanService:
    return plan_service


def get_vendor_service() -> VendorService:
    return vendor_service


def get_fx_service() -> FxService:
    return fx_service


BlockServiceDep = Annotated[BlockService, Depends(get_block_service)]
AreaServiceDep = Annotated[AreaService, Depends(get_area_service)]
SimulationServiceDep = Annotated[SimulationService, Depends(get_simulation_service)]
AgentServiceDep = Annotated[AgentService, Depends(get_agent_service)]
PlanServiceDep = Annotated[PlanService, Depends(get_plan_service)]
VendorServiceDep = Annotated[VendorService, Depends(get_vendor_service)]
FxServiceDep = Annotated[FxService, Depends(get_fx_service)]


def purge_expired() -> int:
    """Drop expired plans and built areas (run at start-up; the repositories also do it hourly while saving)."""
    return plan_repository.purge_expired() + block_repository.purge_expired()
