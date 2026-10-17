"""Turn Pydantic validation errors into one plain sentence for the user; never leak internals."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

_LABELS = {"budget_inr": "Budget", "brief": "Your brief", "name": "Plan name", "years": "Years",
           "placements": "The plan", "block_id": "Block",
           "type": "Item type", "row": "Map cell", "col": "Map cell", "count": "Tree count",
           "bounds": "The area", "north": "The area", "south": "The area", "east": "The area", "west": "The area"}


def _money(v) -> str:
    v = float(v)
    return f"₹{v / 1e7:g} crore" if v >= 1e7 else f"₹{v / 1e5:g} lakh" if v >= 1e5 else f"₹{v:,.0f}"


def readable(err: dict) -> str:
    field = next((str(x) for x in reversed(err.get("loc", ())) if isinstance(x, str) and x != "body"), "")
    if field in ("north", "south", "east", "west", "bounds"):
        return "The area's corners must be real map coordinates."
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


def install(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        errors = exc.errors()
        return JSONResponse(status_code=422, content={"detail": readable(errors[0]) if errors else "Please check your input."})
