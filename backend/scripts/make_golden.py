"""Regenerate shared/fixtures/golden.json from the Python simulator.

Run from backend/:  conda run -n leafit python scripts/make_golden.py
Both test suites (pytest here, vitest in frontend/) replay these cases, so the browser simulator can never
drift from the authoritative one. Regenerate only when the model changes ON PURPOSE.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parents[1]))
from app.config import BLOCKS_DIR, ROOT  # noqa: E402
from app.domain.sim import Block, simulate  # noqa: E402

BLOCK_ID = "demo_lajpat"
block = Block.load(BLOCKS_DIR / f"{BLOCK_ID}.json")
open_cells = np.argwhere(block.building_frac < 0.5)
roofs = np.argwhere(block.roof_area > 0)
road = next((int(r), int(c)) for r, c in open_cells if block.is_class(r, c, "road"))


def trees(n, count=1):
    return [{"type": "tree", "row": int(r), "col": int(c), "count": count} for r, c in open_cells[:n]]


r0, c0 = map(int, roofs[0])
CASES = {
    "empty": ([], 10),
    "fifty_trees": (trees(50), 10),
    "stacked_trees_year1": (trees(5, count=10), 1),
    "roof_only": ([{"type": "cool_roof", "row": r0, "col": c0, "count": 1}], 10),
    "mixed_year30": (trees(120) + [{"type": "cool_roof", "row": r0, "col": c0, "count": 1},
                                   {"type": "shade_stop", "row": road[0], "col": road[1], "count": 1}], 30),
    "thousand_trees": (trees(1000), 10),
}

cases = []
for name, (placements, years) in CASES.items():
    out = simulate(block, placements, years)
    grid = np.array(out["cooling_grid"])
    cases.append({
        "name": name, "block": BLOCK_ID, "years": years, "placements": placements,
        "expected": {
            "metrics": out["metrics"],
            "cooling_sum": round(float(grid.sum()), 2),
            "cooling_max": float(grid.max()),
            "cooling_samples": {f"{r},{c}": float(grid[r, c]) for r, c in [(0, 0), (10, 10), (30, 30), (r0, c0), (59, 59)]},
        },
    })

dest = ROOT / "shared/fixtures/golden.json"
dest.parent.mkdir(exist_ok=True)
dest.write_text(json.dumps({"block": f"backend/data/blocks/{BLOCK_ID}.json", "cases": cases}, indent=1))
print(f"wrote {len(cases)} cases to {dest}")
