"""Generate a SYNTHETIC demo block until the Earth Engine export (plan Phase 2) exists.

Schema (same one ee_export will write):
  grids are row-major, row 0 = north edge, col 0 = west edge, `origin` = NW corner.
  landcover codes index into `landcover_classes`.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter

CLASSES = ["built", "road", "trees", "grass", "bare", "water"]
BUILT, ROAD, TREES, GRASS, BARE = 0, 1, 2, 3, 4


def make(rows=60, cols=60, seed=7):
    rng = np.random.default_rng(seed)
    lc = np.full((rows, cols), BUILT)
    lc[::12, :] = ROAD
    lc[:, ::12] = ROAD
    lc[30:40, 6:18] = TREES          # park
    lc[32:38, 8:16] = GRASS
    lc[8:14, 44:54] = BARE           # empty plot
    bf = np.where(lc == BUILT, rng.uniform(0.55, 0.95, (rows, cols)), 0.0)

    lst = 41.0 + 5 * bf
    lst += np.select([lc == ROAD, lc == TREES, lc == GRASS, lc == BARE], [3.5, -6, -3, 2], 0)
    lst += gaussian_filter(rng.normal(0, 2.5, (rows, cols)), 3)
    lst = gaussian_filter(lst, 0.8)

    return {
        "id": "demo_lajpat",
        "name": "Lajpat Nagar (synthetic demo)",
        "synthetic": True,
        "origin": {"lat": 28.5704, "lng": 77.2402},
        "cell_m": 10,
        "rows": rows,
        "cols": cols,
        "landcover_classes": CLASSES,
        "landcover": lc.tolist(),
        "building_frac": np.round(bf, 2).tolist(),
        "roof_area_m2": np.round(bf * 100, 1).tolist(),
        "lst_c": np.round(lst, 2).tolist(),
        "baseline_aqi": 178,
        # ponytail: hand-placed; real blocks get these from the Places API (plan Phase 6)
        "landmarks": [
            {"name": "Government school", "kind": "school", "row": 20, "col": 45},
            {"name": "Central market", "kind": "market", "row": 50, "col": 30},
            {"name": "Ring Road bus stop", "kind": "bus stop", "row": 12, "col": 18},
            {"name": "Community health centre", "kind": "clinic", "row": 5, "col": 5},
            {"name": "Neighbourhood park", "kind": "park", "row": 35, "col": 12},
        ],
    }


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parents[1] / "data/blocks/demo_lajpat.json")
    out.write_text(json.dumps(make()))
    print("wrote", out)
