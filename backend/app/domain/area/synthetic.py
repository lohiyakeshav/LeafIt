"""Synthetic block generator: the demo block, and (opt-in) a stand-in when Earth Engine is unreachable.

Positions are written as sixtieths of the grid so the 60×60 demo comes out exactly as the committed JSON.
"""
import numpy as np
from scipy.ndimage import gaussian_filter

from app.domain.area.grid import BARE, BUILT, CLASSES, GRASS, ROAD, TREES

LANDMARKS = [("Government school", "school", 20, 45), ("Central market", "market", 50, 30),
             ("Ring Road bus stop", "bus stop", 12, 18), ("Community health centre", "clinic", 5, 5),
             ("Neighbourhood park", "park", 35, 12)]


def make(rows=60, cols=60, seed=7) -> dict:
    """Return the grid part of a block (everything except id/name/origin)."""
    rng = np.random.default_rng(seed)
    r, c = (lambda v: v * rows // 60), (lambda v: v * cols // 60)
    lc = np.full((rows, cols), BUILT)
    lc[::12, :] = ROAD
    lc[:, ::12] = ROAD
    lc[r(30):r(40), c(6):c(18)] = TREES      # park
    lc[r(32):r(38), c(8):c(16)] = GRASS
    lc[r(8):r(14), c(44):c(54)] = BARE       # empty plot
    bf = np.where(lc == BUILT, rng.uniform(0.55, 0.95, (rows, cols)), 0.0)

    lst = 41.0 + 5 * bf
    lst += np.select([lc == ROAD, lc == TREES, lc == GRASS, lc == BARE], [3.5, -6, -3, 2], 0)
    lst += gaussian_filter(rng.normal(0, 2.5, (rows, cols)), 3)
    lst = gaussian_filter(lst, 0.8)

    return {
        "rows": rows, "cols": cols, "cell_m": 10, "landcover_classes": CLASSES,
        "landcover": lc.tolist(), "building_frac": np.round(bf, 2).tolist(),
        "roof_area_m2": np.round(bf * 100, 1).tolist(), "lst_c": np.round(lst, 2).tolist(), "baseline_aqi": 178,
        "landmarks": [{"name": n, "kind": k, "row": r(row), "col": c(col)} for n, k, row, col in LANDMARKS],
    }
