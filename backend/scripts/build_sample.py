"""Build a sample area from real data and ship it with the app, so anyone can open it instantly (no Earth Engine wait).

    cd backend && conda run -n leafit python scripts/build_sample.py [--id lajpat_nagar] [--lat 28.569229 --lng 77.241773] [--size 700]

Same pipeline as a user-drawn area (Landsat heat, WorldCover, Open Buildings, Meta/WRI canopy, WorldPop, OpenStreetMap,
Places, climate normals). It retries until OpenStreetMap answers, because a sample without real roads would be second-rate.
The result goes to data/blocks/<id>.json and is served at /blocks/<id> and /block/<id> in the app.
Default: Lajpat Nagar Central Market, New Delhi (the centre is the Places API location of "Central Market, Lajpat Nagar II").
"""
import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parents[1]))
from app.config import BLOCKS_DIR  # noqa: E402
from app.domain.area.grid import Bounds  # noqa: E402
from app.services import area_builder  # noqa: E402

ATTEMPTS = 6


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", default="lajpat_nagar")
    ap.add_argument("--name", default="Lajpat Nagar Central Market, New Delhi")
    ap.add_argument("--lat", type=float, default=28.569229)
    ap.add_argument("--lng", type=float, default=77.241773)
    ap.add_argument("--size", type=float, default=700, help="side of the square in metres")
    a = ap.parse_args()
    half = a.size / 2
    dlat, dlng = half / 111_320, half / (111_320 * np.cos(np.radians(a.lat)))
    bounds = Bounds(a.lat + dlat, a.lat - dlat, a.lng + dlng, a.lng - dlng)
    for attempt in range(1, ATTEMPTS + 1):
        t = time.perf_counter()
        area = asyncio.run(area_builder.build_area(bounds, a.name))
        print(f"attempt {attempt}: {time.perf_counter() - t:.0f}s, roads from {area['roads_source']}, canopy from {area['canopy_source']}, "
              f"people from {area.get('population_source')}, climate {area['climate'].get('class')}, {len(area['landmarks'])} landmarks")
        if area["roads_source"] == "osm":
            break
        time.sleep(20)
    else:
        sys.exit("OpenStreetMap did not answer; try again later (the sample was not written)")
    area["id"], area["sample"] = a.id, True
    BLOCKS_DIR.mkdir(parents=True, exist_ok=True)
    out = BLOCKS_DIR / f"{a.id}.json"
    out.write_text(json.dumps(area, separators=(",", ":")))
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
