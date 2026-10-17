"""Live Earth Engine check. Run after the service account has access:

    cd backend && conda run -n leafit python scripts/ee_smoke.py [lat lng]

Builds a real 600 m × 600 m area (default: Lajpat Nagar, Delhi) and prints what came back, so you can eyeball it:
roads/roofs should be the hottest (about 45–55 °C in a Delhi summer), parks/water cooler, building count in the hundreds.
"""
import asyncio
import json
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parents[1]))
from app.domain.area.grid import CLASSES, Bounds  # noqa: E402
from app.services import area_builder  # noqa: E402

lat, lng = (float(sys.argv[1]), float(sys.argv[2])) if len(sys.argv) > 2 else (28.5704, 77.2402)
dlat, dlng = 300 / 111_320, 300 / (111_320 * np.cos(np.radians(lat)))
t = time.perf_counter()
block = asyncio.run(area_builder.build_area(Bounds(lat + dlat, lat - dlat, lng + dlng, lng - dlng), "smoke test"))
print(f"built in {time.perf_counter() - t:.1f}s  source={block['source']}  grid={block['rows']}x{block['cols']}")

lst, lc, bf = np.array(block["lst_c"]), np.array(block["landcover"]), np.array(block["building_frac"])
print(f"surface temp  min {lst.min():.1f}  mean {lst.mean():.1f}  max {lst.max():.1f} °C   ({block.get('lst_period')})")
for i, name in enumerate(CLASSES):
    if (lc == i).any():
        print(f"  {name:6s} {100 * (lc == i).mean():5.1f}% of cells, mean {lst[lc == i].mean():.1f} °C")
print(f"buildings: {len(block.get('buildings', []))}, mean footprint cover {bf.mean():.2f}, "
      f"heights {Counter(round(b['height_m']) for b in block.get('buildings', [])).most_common(4)}")
print("conditions:", block["conditions"], "| landmarks:", [lm["name"] for lm in block["landmarks"]])

# what the model and the agent will actually use
canopy, carriageway = np.array(block["canopy_frac"]), np.array(block["carriageway_frac"])
print(f"canopy ({block['canopy_source']}): {100 * canopy.mean():.1f}% of the area, mean height {np.array(block['canopy_h'])[canopy > 0].mean() if (canopy > 0).any() else 0:.1f} m; "
      f"disagrees with WorldCover in {block.get('canopy_disagrees_with_worldcover_pct')}% of cells")
ring = block.get("ring")
if ring:
    rc = np.array(ring["canopy_frac"])
    print(f"ring {ring['pad']} cells: canopy {100 * rc.mean():.1f}% overall (area {100 * canopy.mean():.1f}%), "
          f"hottest ring cell {np.array(ring['lst_c']).max():.1f} °C")
print(f"roads ({block['roads_source']}): carriageway covers {100 * (carriageway >= 0.5).mean():.1f}% of cells (blocked for trees), "
      f"{len(block['roads'])} named: {[(r['name'], r['type'], r['width_m']) for r in block['roads'][:5]]}")
if block.get("population") is not None:
    pop, vuln = np.array(block["population"]), np.array(block["vulnerable"])
    print(f"people ({block['population_source']}): {block['population_total']:,} in the area, {vuln.sum():,.0f} vulnerable (under 5 or 65+); "
          f"densest cell {pop.max():.0f}, cells with none {100 * (pop == 0).mean():.0f}%")
else:
    print("people: unavailable")
print("climate:", block["climate"])
print(f"json size: {len(json.dumps(block)) / 1024:.0f} KB")
