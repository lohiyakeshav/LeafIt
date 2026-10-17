"""Climate class from hot-season humidity: it decides the airflow rule for planting, nothing else (no invented coefficients)."""
import math

from app.config import MODEL

CLASSES = MODEL["climate_classes"]


def classify(rh_pct: float | None) -> str | None:
    """hot_dry / composite / humid from the hot-season mean relative humidity, or None when unknown."""
    if rh_pct is None:
        return None
    if rh_pct < CLASSES["hot_dry_below_rh_pct"]:
        return "hot_dry"
    return "humid" if rh_pct > CLASSES["humid_above_rh_pct"] else "composite"


def mean_direction(degrees: list[float]) -> float | None:
    """Circular mean of compass directions (a plain average of 350° and 10° would say 180°)."""
    if not degrees:
        return None
    s = sum(math.sin(math.radians(d)) for d in degrees)
    c = sum(math.cos(math.radians(d)) for d in degrees)
    return round(math.degrees(math.atan2(s, c)) % 360, 0)


def hot_months(lat: float) -> tuple[int, int]:
    """Months (inclusive, may wrap the year) that count as the 'hot season' for a latitude."""
    if lat < 0:
        return (12, 2)
    return (4, 6) if lat < 35 else (6, 8)


def in_months(month: int, months: tuple[int, int]) -> bool:
    lo, hi = months
    return lo <= month <= hi if lo <= hi else month >= lo or month <= hi
