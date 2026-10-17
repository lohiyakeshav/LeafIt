"""Pure geometry for a user-drawn area: size limits, the 10 m cell grid, ids, and land-cover classes.

No network and no Earth Engine in here, so all of it is unit-tested offline.
"""
import hashlib
import math
from dataclasses import dataclass

import numpy as np

from app.config import MODEL

M_PER_DEG_LAT = 111_320
CLASSES = ["built", "road", "trees", "grass", "bare", "water"]  # same order as the demo block
BUILT, ROAD, TREES, GRASS, BARE, WATER = range(6)
LIMITS = MODEL["area"]

# ESA WorldCover v200 class values -> our classes (road is derived later: built-up ground with no building on it)
_WORLDCOVER = {10: TREES, 20: GRASS, 30: GRASS, 40: GRASS, 50: BUILT, 60: BARE, 70: BARE, 80: WATER, 90: GRASS, 95: TREES, 100: GRASS}


@dataclass(frozen=True)
class Bounds:
    north: float
    south: float
    east: float
    west: float

    @property
    def center(self) -> tuple[float, float]:
        return (self.north + self.south) / 2, (self.east + self.west) / 2

    @property
    def size_m(self) -> tuple[float, float]:
        """(width, height) in metres using a local equirectangular approximation (fine at neighbourhood scale)."""
        lat = math.radians(self.center[0])
        return ((self.east - self.west) * M_PER_DEG_LAT * math.cos(lat), (self.north - self.south) * M_PER_DEG_LAT)

    @property
    def area_km2(self) -> float:
        w, h = self.size_m
        return w * h / 1e6


def validate(b: Bounds) -> None:
    """Raise ValueError with a sentence the user can act on if the area is outside the MVP limits."""
    if not (-90 <= b.south < b.north <= 90 and -180 <= b.west < b.east <= 180):
        raise ValueError("The area's corners are not valid: north must be above south and east right of west.")
    w, h = b.size_m
    slack = 1 + LIMITS["tolerance"]  # a box drawn "at the limit" must not flicker over it from rounding
    lo, hi, hi_km2 = LIMITS["min_side_m"] / slack, LIMITS["max_side_m"] * slack, LIMITS["max_km2"] * slack
    if min(w, h) < lo:
        raise ValueError(f"That area is too small ({w:.0f} m × {h:.0f} m). Each side must be at least {LIMITS["min_side_m"]} m.")
    if max(w, h) > hi or b.area_km2 > hi_km2:
        raise ValueError(f"That area is too large ({b.area_km2:.2f} km²). Pick at most {LIMITS["max_km2"]:g} km², with no side over {LIMITS["max_side_m"]} m.")


def area_id(b: Bounds) -> str:
    """Stable id from the bounds rounded to ~1 m, so drawing the same box twice hits the cache."""
    key = ",".join(f"{v:.5f}" for v in (b.north, b.south, b.east, b.west))
    return "a_" + hashlib.sha1(key.encode()).hexdigest()[:12]


@dataclass(frozen=True)
class Grid:
    rows: int
    cols: int
    cell_m: float
    north: float
    west: float
    dlat: float  # degrees per cell, south-ward
    dlng: float  # degrees per cell, east-ward

    @property
    def south(self) -> float:
        return self.north - self.rows * self.dlat

    @property
    def east(self) -> float:
        return self.west + self.cols * self.dlng

    def cell_of(self, lat: float, lng: float) -> tuple[int, int] | None:
        r, c = int((self.north - lat) / self.dlat), int((lng - self.west) / self.dlng)
        return (r, c) if 0 <= r < self.rows and 0 <= c < self.cols else None

    def to_local_m(self, lat: float, lng: float) -> tuple[float, float]:
        """(x east, z south) metres from the NW corner; the 3D view uses the same axes."""
        return (lng - self.west) / self.dlng * self.cell_m, (self.north - lat) / self.dlat * self.cell_m


def make_grid(b: Bounds, cell_m: float | None = None) -> Grid:
    cell_m = cell_m or LIMITS["cell_m"]
    lat = math.radians(b.center[0])
    dlat = cell_m / M_PER_DEG_LAT
    dlng = cell_m / (M_PER_DEG_LAT * math.cos(lat))
    rows = max(1, round((b.north - b.south) / dlat))
    cols = max(1, round((b.east - b.west) / dlng))
    return Grid(rows, cols, cell_m, b.north, b.west, dlat, dlng)


def classify(worldcover: np.ndarray, building_frac: np.ndarray) -> np.ndarray:
    """WorldCover codes + building coverage -> our six classes. Road = built-up ground with (almost) no building on it."""
    lc = np.full(worldcover.shape, BARE, dtype=np.int64)
    for code, cls in _WORLDCOVER.items():
        lc[worldcover == code] = cls
    lc[(lc == BUILT) & (building_frac < 0.2)] = ROAD
    lc[building_frac >= 0.5] = BUILT  # satellite building footprints beat the coarser land-cover class
    return lc
