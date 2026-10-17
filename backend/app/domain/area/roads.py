"""Carriageway share per cell from OpenStreetMap roads, with honest fallbacks when widths aren't tagged.

Width precedence: a valid `width` tag, else `lanes` × 3.5 m, else the default for the road type (estimates, flagged in
/assumptions). Footways, paths and cycleways are NOT carriageway: they are the pedestrian edge where street trees belong.
"""
import re

import numpy as np

from app.config import MODEL
from app.domain.area.grid import Grid

WIDTHS = MODEL["carriageway_width_m"]
LANE_M = MODEL["lane_width_m"]
SAMPLES = 4          # each 10 m cell is sampled on a 4 × 4 grid (2.5 m apart): enough for road widths of 4 m and up
NOT_CARRIAGEWAY = {"footway", "path", "cycleway", "pedestrian", "steps", "track", "bridleway", "corridor", "proposed", "construction"}


def width_m(tags: dict) -> float | None:
    """Carriageway width in metres, or None for ways that are not carriageway."""
    kind = tags.get("highway", "")
    base = kind.removesuffix("_link")
    if base in NOT_CARRIAGEWAY or base not in WIDTHS:
        return None
    if m := re.match(r"^\s*(\d+(?:\.\d+)?)\s*(m)?\s*$", str(tags.get("width", ""))):
        w = float(m.group(1))
        if 2.0 <= w <= 40.0:
            return w
    if str(tags.get("lanes", "")).isdigit() and 1 <= int(tags["lanes"]) <= 8:
        return int(tags["lanes"]) * LANE_M
    return float(WIDTHS[base])


def rasterise(ways: list[dict], grid: Grid) -> tuple[np.ndarray, list[dict]]:
    """(carriageway_frac, roads) for OSM ways {"tags": {...}, "geometry": [{"lat", "lon"}, ...]}.

    `roads` lists the named carriageways inside the area as {name, type, width_m, points: [[x, z], ...]} (metres from the
    north-west corner) for the agent and the 3D view.
    """
    k = SAMPLES
    step = grid.cell_m / k
    hi = np.zeros((grid.rows * k, grid.cols * k), bool)
    roads = []
    for way in ways:
        w = width_m(way.get("tags", {}))
        pts = [grid.to_local_m(g["lat"], g["lon"]) for g in way.get("geometry", [])]
        if w is None or len(pts) < 2:
            continue
        for (x0, z0), (x1, z1) in zip(pts, pts[1:], strict=False):
            _stamp(hi, x0 / step, z0 / step, x1 / step, z1 / step, w / 2 / step)
        tags = way["tags"]
        xs, zs = [x for x, _ in pts], [z for _, z in pts]
        # whole ways come back from OSM, usually reaching far outside the box: keep the ones whose extent overlaps it
        if tags.get("name") and max(xs) >= 0 and min(xs) <= grid.cols * grid.cell_m and max(zs) >= 0 and min(zs) <= grid.rows * grid.cell_m:
            roads.append({"name": tags["name"], "type": tags["highway"], "width_m": round(w, 1), "points": [[round(x, 1), round(z, 1)] for x, z in pts]})
    return hi.reshape(grid.rows, k, grid.cols, k).mean(axis=(1, 3)), roads


def _stamp(hi: np.ndarray, x0, z0, x1, z1, half) -> None:
    """Mark every sample point within `half` of the segment (all in sample units)."""
    ax, az = max(0, int(min(x0, x1) - half) - 1), max(0, int(min(z0, z1) - half) - 1)
    bx, bz = min(hi.shape[1], int(max(x0, x1) + half) + 2), min(hi.shape[0], int(max(z0, z1) + half) + 2)
    if bx <= ax or bz <= az:
        return
    gx, gz = np.meshgrid(np.arange(ax, bx) + 0.5, np.arange(az, bz) + 0.5)
    dx, dz = x1 - x0, z1 - z0
    length2 = dx * dx + dz * dz
    t = np.clip(((gx - x0) * dx + (gz - z0) * dz) / length2, 0, 1) if length2 else np.zeros_like(gx)
    hi[az:bz, ax:bx] |= (gx - (x0 + t * dx)) ** 2 + (gz - (z0 + t * dz)) ** 2 <= half * half
