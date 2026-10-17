"""Generate the SYNTHETIC demo block (the grid logic lives in app/domain/area/synthetic.py; real areas come from Earth Engine).

Schema (same one app/services/area_builder.py writes):
  grids are row-major, row 0 = north edge, col 0 = west edge, `origin` = NW corner.
  landcover codes index into `landcover_classes`.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
from app.domain.area.synthetic import make as make_grids  # noqa: E402


def make(rows=60, cols=60, seed=7):
    return {"id": "demo_lajpat", "name": "Lajpat Nagar (synthetic demo)", "synthetic": True,
            "origin": {"lat": 28.5704, "lng": 77.2402}, **make_grids(rows, cols, seed)}


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parents[1] / "data/blocks/demo_lajpat.json")
    out.write_text(json.dumps(make()))
    print("wrote", out)
