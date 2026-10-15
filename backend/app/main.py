import base64
import binascii
import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, StringConstraints
from typing import Annotated

from . import agent, market, photo, proposal
from .sim import ASSUMPTIONS, Block, simulate

DATA = Path(__file__).parents[1] / "data/blocks"
WEB = Path(os.environ.get("LEAFIT_WEB_DIR", Path(__file__).parents[2] / "app/build/web"))
BLOCKS = {p.stem: (Block.load(p), p) for p in DATA.glob("*.json")}

MIN_BUDGET_INR, MAX_BUDGET_INR = 10_000, 1_000_000_000  # ₹10,000 (≈3 trees) to ₹100 crore; app mirrors these

app = FastAPI(title="LeafIt")

_LABELS = {"budget_inr": "Budget", "brief": "Your brief", "name": "Plan name", "years": "Years",
           "placements": "The plan", "image_b64": "The photo", "mime_type": "The photo type", "block_id": "Block",
           "type": "Item type", "row": "Map cell", "col": "Map cell", "count": "Tree count"}


def _money(v) -> str:
    v = float(v)
    return f"₹{v / 1e7:g} crore" if v >= 1e7 else f"₹{v / 1e5:g} lakh" if v >= 1e5 else f"₹{v:,.0f}"


def _readable(err: dict) -> str:
    """One plain sentence for a validation error; never leak Pydantic's internals to the user."""
    field = next((str(x) for x in reversed(err.get("loc", ())) if isinstance(x, str) and x != "body"), "")
    label, kind, ctx = _LABELS.get(field, "A value"), err.get("type", ""), err.get("ctx", {})
    limit = next((ctx[k] for k in ("le", "lt", "ge", "gt", "max_length", "min_length") if k in ctx), None)
    fmt = (lambda v: _money(v)) if field == "budget_inr" else (lambda v: f"{v:,}" if isinstance(v, (int, float)) else str(v))
    if kind in ("less_than_equal", "less_than"):
        return f"{label} can be at most {fmt(limit)}."
    if kind in ("greater_than_equal", "greater_than"):
        return f"{label} must be at least {fmt(limit)}."
    if kind == "string_too_long":
        return f"{label} is too long (max {limit} characters)."
    if kind == "too_long":
        return f"{label} has too many items (max {limit:,})."
    if kind == "missing":
        return f"{label} is required."
    if kind in ("float_parsing", "int_parsing", "float_type", "int_type", "finite_number"):
        return f"{label} must be a number."
    return f"{label} isn't valid."


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError):
    errors = exc.errors()
    return JSONResponse(status_code=422, content={"detail": _readable(errors[0]) if errors else "Please check your input."})
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])  # Flutter web dev


class Placement(BaseModel):
    type: Literal["tree", "cool_roof", "shade_stop"]
    row: int
    col: int
    count: int = 1


class SimRequest(BaseModel):
    block_id: str
    placements: list[Placement] = Field(max_length=5000)
    years: int = Field(10, ge=1, le=30)


class AgentRequest(BaseModel):
    block_id: str
    brief: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
    budget_inr: float = Field(ge=MIN_BUDGET_INR, le=MAX_BUDGET_INR)
    years: int = Field(10, ge=1, le=30)


class PhotoRequest(BaseModel):
    image_b64: str = Field(max_length=10_000_000)  # ~7 MB image
    mime_type: Literal["image/jpeg", "image/png", "image/webp"] = "image/jpeg"


class PlanIn(SimRequest):
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] = "Untitled plan"


class QuoteRequest(BaseModel):
    plan_id: str
    vendor_id: str


def _block(block_id):
    if block_id not in BLOCKS:
        raise HTTPException(404, "unknown block")
    return BLOCKS[block_id]


def _sim(block, placements, years):
    try:
        return simulate(block, placements, years)
    except ValueError as e:
        raise HTTPException(422, str(e))


def _plan(pid):
    plan = market.load_plan(pid)
    if not plan:
        raise HTTPException(404, "unknown plan")
    return plan


@app.get("/blocks")
def list_blocks():
    return [{k: b.meta[k] for k in ("id", "name", "origin", "synthetic") if k in b.meta} for b, _ in BLOCKS.values()]


@app.get("/blocks/{block_id}")
def get_block(block_id: str):
    return Response(_block(block_id)[1].read_text(), media_type="application/json")  # raw cached JSON


@app.post("/simulate")
def post_simulate(req: SimRequest):
    return _sim(_block(req.block_id)[0], [p.model_dump() for p in req.placements], req.years)


@app.get("/assumptions")
def assumptions():
    return ASSUMPTIONS


@app.post("/agent")
def post_agent(req: AgentRequest):
    return agent.plan(_block(req.block_id)[0], req.brief, req.budget_inr, req.years)


@app.post("/photo")
def post_photo(req: PhotoRequest):
    try:
        image = base64.b64decode(req.image_b64, validate=True)
    except binascii.Error:
        raise HTTPException(422, "image_b64 is not valid base64")
    try:
        return photo.analyse(image, req.mime_type)
    except photo.Unavailable as e:
        raise HTTPException(503, str(e))


@app.post("/plans")
def create_plan(req: PlanIn):
    _sim(_block(req.block_id)[0], [p.model_dump() for p in req.placements], req.years)  # validate before saving
    return {"id": market.save_plan({**req.model_dump(), "name": req.name or "Untitled plan"})}


@app.get("/plans/{pid}")
def get_plan(pid: str):
    plan = _plan(pid)
    return {**plan, "metrics": _sim(_block(plan["block_id"])[0], plan["placements"], plan["years"])["metrics"]}


@app.get("/plans/{pid}/bom")
def get_bom(pid: str):
    plan = _plan(pid)
    return market.bom(_block(plan["block_id"])[0], plan["placements"])


@app.post("/plans/{pid}/proposal")
def post_proposal(pid: str):
    plan = _plan(pid)
    block = _block(plan["block_id"])[0]
    ctx = {"block": block.meta["name"], "plan_name": plan["name"], "years": plan["years"],
           "metrics": _sim(block, plan["placements"], plan["years"])["metrics"],
           "bill_of_materials": market.bom(block, plan["placements"])}
    return proposal.write(ctx)


@app.get("/vendors")
def vendors(block_id: str, category: str | None = None, radius_km: float = 15):
    cats = set(category.split(",")) if category else None
    return market.find_vendors(market.center(_block(block_id)[0]), cats, radius_km)


@app.post("/quotes")
def quotes(req: QuoteRequest):
    plan = _plan(req.plan_id)
    vendor = next((v for v in market.VENDORS if v["id"] == req.vendor_id), None)
    if not vendor:
        raise HTTPException(404, "unknown vendor")
    block = _block(plan["block_id"])[0]
    return market.quote_links(plan, block, market.bom(block, plan["placements"]), vendor)


if WEB.is_dir():  # Flutter web build: one Cloud Run service serves app + API. Registered last so API routes win.
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
