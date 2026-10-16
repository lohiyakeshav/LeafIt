"""Live Earth Engine check. Run after the service account has access:

    cd backend && conda run -n leafit python scripts/ee_smoke.py [lat lng]

Builds a real 600 m × 600 m area (default: Lajpat Nagar, Delhi) and prints what came back, so you can eyeball it:
roads/roofs should be the hottest (about 45–55 °C in a Delhi summer), parks/water cooler, building count in the hundreds.
"""
import asyncio
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parents[1]))
from app.geodata import area_builder  # noqa: E402
from app.geodata.grid import CLASSES, Bounds  # noqa: E402

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
print("conditions:", block["conditions"], "| landmarks:", [l["name"] for l in block["landmarks"]])
