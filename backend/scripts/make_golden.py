"""Regenerate shared/fixtures/golden.json from the Python simulator.

Run from backend/:  conda run -n leafit python scripts/make_golden.py
Both test suites (pytest here, vitest in frontend/) replay these cases, so the browser simulator can never
drift from the authoritative one. Regenerate only when the model changes ON PURPOSE.

A case may override parts of the sample block (OVERRIDABLE), which is how the rules that the sample block alone can't
exercise (humid climates, trees in the ring around the area, population exposure, bare ground) stay covered.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parents[1]))
from app.config import BLOCKS_DIR, ROOT  # noqa: E402
from app.domain import plantable  # noqa: E402
from app.domain import species as species_mod  # noqa: E402
from app.domain.sim import Block, simulate  # noqa: E402

BLOCK_ID = "lajpat_nagar"   # the shipped sample: real Earth Engine / OpenStreetMap / WorldPop data
RAW = json.loads((BLOCKS_DIR / f"{BLOCK_ID}.json").read_text())
block = Block.from_dict(RAW)
rows, cols = block.lst.shape
roofs = np.argwhere(block.roof_area > 0)
plantable_cells = np.argwhere((plantable.capacity_grid(block, species_mod.get(None)) >= 1) & (block.building_frac < 0.5))
road = next((int(r), int(c)) for r, c in np.argwhere(block.building_frac < 0.5) if block.is_class(r, c, "road"))
r0, c0 = map(int, roofs[0])


def trees(n, count=1, species=None, start=0):
    return [{"type": "tree", "row": int(r), "col": int(c), "count": count, **({"species": species} if species else {})}
            for r, c in plantable_cells[start:start + n]]


# a park just outside the area's north edge, and a smooth "where the vulnerable people live" surface in the south-east
PAD = 6
ring = {"pad": PAD, "canopy_frac": np.zeros((rows + 2 * PAD, cols + 2 * PAD)), "canopy_h": np.zeros((rows + 2 * PAD, cols + 2 * PAD))}
ring["canopy_frac"][:PAD, PAD + 10:PAD + 50] = 0.7
ring["canopy_h"][:PAD, PAD + 10:PAD + 50] = 10.0
ring = {"pad": PAD, **{k: np.round(ring[k], 2).tolist() for k in ("canopy_frac", "canopy_h")}}
yy, xx = np.indices((rows, cols))
exposure = np.round(np.exp(-((yy - 45) ** 2 + (xx - 45) ** 2) / (2 * 8**2)), 3).tolist()
shaded = block.canopy_frac >= 0.6
beside_park = [{"type": "tree", "row": int(r), "col": int(c), "count": 1} for r, c in plantable_cells
               if shaded[max(r - 1, 0):r + 2, max(c - 1, 0):c + 2].any()][:20]   # next to existing dense canopy
near_peak = [{"type": "tree", "row": int(r), "col": int(c), "count": 1} for r, c in plantable_cells
             if abs(r - 45) <= 9 and abs(c - 45) <= 9][:40]   # inside the high-exposure quartile
top_edge = [{"type": "tree", "row": int(r), "col": int(c), "count": 1} for r, c in plantable_cells if r <= 3][:15]
ok = plantable.capacity_grid(block, species_mod.get(None)) >= 1
ho, hc = next((r, c) for r in range(rows - 2) for c in range(cols - 2) if ok[r:r + 3, c:c + 3].all())   # a 3×3 patch where trees may go
no_canopy = {"canopy_frac": np.zeros((rows, cols)).tolist(), "canopy_h": np.zeros((rows, cols)).tolist()}   # so 9 crowns sit exactly at the limit
humid_3x3 = [{"type": "tree", "row": r, "col": c, "count": 1} for r in range(ho, ho + 3) for c in range(hc, hc + 3)]

CASES = {
    "empty": {"placements": [], "years": 10},
    "fifty_trees": {"placements": trees(50), "years": 10},
    "two_per_cell_year1": {"placements": trees(5, count=2), "years": 1},
    "roof_only": {"placements": [{"type": "cool_roof", "row": r0, "col": c0, "count": 1}], "years": 10},
    "mixed_year30": {"placements": trees(120) + [{"type": "cool_roof", "row": r0, "col": c0, "count": 1},
                                                 {"type": "shade_stop", "row": road[0], "col": road[1], "count": 1}], "years": 30},
    "many_trees": {"placements": trees(min(1000, len(plantable_cells))), "years": 10},
    "species_mix": {"placements": trees(8, species="peepal") + trees(8, species="amaltas", start=8) + trees(8, species="kadamb", start=16)
                    + trees(8, species="neem", start=24), "years": 15},
    "beside_existing_park": {"placements": beside_park, "years": 10},
    "park_in_the_ring": {"placements": top_edge, "years": 10, "ring": ring},
    "humid_at_the_limit": {"placements": humid_3x3, "years": 10, "climate": {"class": "humid"}, **no_canopy},
    "equity_quartile": {"placements": near_peak, "years": 10, "exposure": exposure},
}


OVERRIDABLE = ["climate", "ring", "exposure", "canopy_frac", "canopy_h"]   # written into the fixture, so both test suites use this list


def case_block(case: dict) -> Block:
    d = dict(RAW)
    for key in OVERRIDABLE:
        if key in case:
            d[key] = case[key]
    return Block.from_dict(d)


cases = []
for name, case in CASES.items():
    out = simulate(case_block(case), case["placements"], case["years"])
    grid = np.array(out["cooling_grid"])
    cases.append({
        "name": name, "block": BLOCK_ID, **case,
        "expected": {
            "metrics": out["metrics"],
            "cooling_sum": round(float(grid.sum()), 2),
            "cooling_max": float(grid.max()),
            "cooling_samples": {f"{r},{c}": float(grid[r, c]) for r, c in [(0, 0), (10, 10), (30, 30), (r0, c0), (rows - 1, cols - 1)]},
        },
    })

dest = ROOT / "shared/fixtures/golden.json"
dest.parent.mkdir(exist_ok=True)
dest.write_text(json.dumps({"block": f"backend/data/blocks/{BLOCK_ID}.json", "overridable": OVERRIDABLE, "cases": cases}, separators=(",", ":")))
print(f"wrote {len(cases)} cases to {dest} ({dest.stat().st_size // 1024} KB)")
