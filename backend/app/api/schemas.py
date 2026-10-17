"""Request models. Limits here are mirrored by the web app (and by shared/model.json for geometry)."""
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

MIN_BUDGET_INR, MAX_BUDGET_INR = 10_000, 1_000_000_000  # ₹10,000 (≈3 trees) to ₹100 crore


class Placement(BaseModel):
    type: Literal["tree", "cool_roof", "shade_stop"]
    row: int
    col: int
    count: int = 1
    building_id: str | None = None  # set by the 3D view for roofs; the model itself works on cells
    species: str | None = Field(None, max_length=40)   # trees: a catalogue id (shared/species.json); none = the generic tree


class UnitCost(BaseModel):
    """User-edited prices (₹). Any left out keep the sourced defaults in shared/model.json."""
    tree: float | None = Field(None, gt=0, le=1_000_000)          # per tree
    cool_roof: float | None = Field(None, gt=0, le=100_000)       # per m²
    shade_stop: float | None = Field(None, gt=0, le=100_000_000)  # per stop

    def as_dict(self) -> dict:
        return {k: v for k, v in self.model_dump().items() if v is not None}


class SimRequest(BaseModel):
    block_id: str
    placements: list[Placement] = Field(max_length=5000)
    years: int = Field(10, ge=1, le=30)
    unit_cost: UnitCost | None = None


class AgentRequest(BaseModel):
    block_id: str
    brief: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    budget_inr: float = Field(ge=MIN_BUDGET_INR, le=MAX_BUDGET_INR)
    years: int = Field(10, ge=1, le=30)
    unit_cost: UnitCost | None = None


class PlanIn(SimRequest):
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] = "Untitled plan"


class BoundsIn(BaseModel):
    north: float = Field(ge=-90, le=90)
    south: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    west: float = Field(ge=-180, le=180)


class AreaIn(BaseModel):
    bounds: BoundsIn
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] = "Selected area"


class QuoteRequest(BaseModel):
    plan_id: str
    vendor_id: str


class ProposalIn(BaseModel):
    currency: str = Field("INR", pattern=r"^[A-Z]{3}$")   # ISO 4217; amounts are converted for display only
