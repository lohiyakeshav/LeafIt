"""Building footprints: GeoJSON polygons -> local-metre polygons for the 3D view, and -> per-cell coverage for the model.

Both come from the SAME polygons, so what the user sees in 3D is exactly what the simulation counts.
"""
import numpy as np

from app.domain.area.grid import Grid

DEFAULT_HEIGHT_M = 6.0   # used where the height raster has no value (about two storeys)
CONFIDENCE_MIN = 0.75    # Open Buildings footprints below this detection confidence are left out
MIN_HEIGHT_M, MAX_HEIGHT_M = 3.0, 80.0
SUPERSAMPLE = 8          # each 10 m cell is sampled on an 8×8 grid of points (1.25 m apart)


def parse_features(features: list[dict], grid: Grid, height_at) -> list[dict]:
    """Keep polygons that touch the grid; return [{id, area_m2, height_m, poly: [[x, z], ...]}] in metres from the NW corner.

    `height_at(lat, lng)` returns metres or None. Only the outer ring is kept (courtyards are ignored).
    """
    out, seen = [], set()
    w, h = grid.cols * grid.cell_m, grid.rows * grid.cell_m
    for f in features:
        props, geom = f.get("properties", {}), f.get("geometry") or {}
        rings = geom.get("coordinates", [])
        if geom.get("type") == "MultiPolygon":
            rings = [r[0] for r in rings]
        elif geom.get("type") == "Polygon":
            rings = rings[:1]
        else:
            continue
        for ring in rings:
            pts = [grid.to_local_m(lat, lng) for lng, lat in ring]
            if len(pts) < 4:
                continue
            xs, zs = [p[0] for p in pts], [p[1] for p in pts]
            if max(xs) < 0 or min(xs) > w or max(zs) < 0 or min(zs) > h:
                continue
            bid = props.get("full_plus_code") or f"b{len(out)}"
            if bid in seen:  # a footprint straddling two query tiles arrives twice
                continue
            seen.add(bid)
            clat = sum(c[1] for c in ring) / len(ring)
            clng = sum(c[0] for c in ring) / len(ring)
            height = height_at(clat, clng)
            height = float(np.clip(height, MIN_HEIGHT_M, MAX_HEIGHT_M)) if height else DEFAULT_HEIGHT_M
            area = 0.5 * abs(sum(xs[i] * zs[i + 1] - xs[i + 1] * zs[i] for i in range(len(pts) - 1)))
            out.append({"id": bid, "area_m2": round(area, 1), "height_m": round(height, 1),
                        "poly": [[round(x, 1), round(z, 1)] for x, z in pts[:-1]]})  # drop the repeated closing point
    return out


def _inside(x: np.ndarray, z: np.ndarray, poly: np.ndarray) -> np.ndarray:
    """Even-odd ray casting for many points at once."""
    inside = np.zeros(x.shape, bool)
    for i in range(len(poly)):
        (x1, z1), (x2, z2) = poly[i], poly[(i + 1) % len(poly)]
        if z1 == z2:
            continue
        crosses = (z1 > z) != (z2 > z)
        inside ^= crosses & (x < x1 + (z - z1) * (x2 - x1) / (z2 - z1))
    return inside


def coverage(buildings: list[dict], grid: Grid) -> np.ndarray:
    """Share (0..1) of each cell covered by building footprints.

    Samples pixel centres, which is unbiased (drawing library fills are edge-inclusive and overstate small buildings by 25%+).
    """
    ss = SUPERSAMPLE
    hi = np.zeros((grid.rows * ss, grid.cols * ss), bool)
    step = grid.cell_m / ss
    for b in buildings:
        poly = np.asarray(b["poly"], dtype=float) / step
        x0, z0 = np.maximum(np.floor(poly.min(axis=0)).astype(int), 0)
        x1, z1 = np.minimum(np.ceil(poly.max(axis=0)).astype(int), [hi.shape[1], hi.shape[0]])
        if x1 <= x0 or z1 <= z0:
            continue
        gx, gz = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(z0, z1) + 0.5)
        hi[z0:z1, x0:x1] |= _inside(gx, gz, poly)  # OR: overlapping footprints don't count twice
    return hi.reshape(grid.rows, ss, grid.cols, ss).mean(axis=(1, 3))


def floor_area(buildings: list[dict], grid: Grid, storey_m: float = 3.0) -> np.ndarray:
    """Building floor area (m²) per cell: footprint × storeys (height ÷ 3 m), the weight people are shared out by."""
    ss = SUPERSAMPLE
    step = grid.cell_m / ss
    hi = np.zeros((grid.rows * ss, grid.cols * ss))
    for b in buildings:
        poly = np.asarray(b["poly"], dtype=float) / step
        x0, z0 = np.maximum(np.floor(poly.min(axis=0)).astype(int), 0)
        x1, z1 = np.minimum(np.ceil(poly.max(axis=0)).astype(int), [hi.shape[1], hi.shape[0]])
        if x1 <= x0 or z1 <= z0:
            continue
        gx, gz = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(z0, z1) + 0.5)
        hi[z0:z1, x0:x1] += _inside(gx, gz, poly) * max(1.0, b["height_m"] / storey_m)
    return hi.reshape(grid.rows, ss, grid.cols, ss).sum(axis=(1, 3)) * step * step
