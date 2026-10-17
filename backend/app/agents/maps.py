"""Two small pictures for the planning agent: where it is hot, and where shade exists and trees can go.

Gemini reads images well, and a labelled picture of the zones makes "the hot north-east corner beside the market" something it can
actually see, not just infer from a table. Both pictures carry the same 3 × 3 zone grid the tools use.
"""
import io

import numpy as np
from PIL import Image, ImageDraw

from app.domain import plantable, zones
from app.domain import species as species_mod
from app.domain.sim import Block

TARGET_PX = 384
HEAT_RAMP = np.array([[44, 123, 182], [171, 217, 233], [255, 255, 191], [253, 174, 97], [215, 25, 28]], float)   # cool blue → hot red (the app's own)


def _ramp(t: np.ndarray) -> np.ndarray:
    x = np.clip(t, 0, 1) * (len(HEAT_RAMP) - 1)
    i = np.minimum(x.astype(int), len(HEAT_RAMP) - 2)
    f = (x - i)[..., None]
    return HEAT_RAMP[i] * (1 - f) + HEAT_RAMP[i + 1] * f


def _frame(rgb: np.ndarray, block: Block, label: str) -> bytes:
    rows, cols = rgb.shape[:2]
    k = max(1, TARGET_PX // max(rows, cols))
    img = Image.fromarray(rgb.astype(np.uint8)).resize((cols * k, rows * k), Image.NEAREST)
    d = ImageDraw.Draw(img)
    for z, (r0, r1, c0, c1) in zones.bounds(rows, cols).items():
        d.rectangle([c0 * k, r0 * k, c1 * k - 1, r1 * k - 1], outline=(255, 255, 255), width=1)
        d.text((c0 * k + 4, r0 * k + 3), z, fill=(20, 20, 20))
    for lm in block.meta.get("landmarks", []):
        x, y = (lm["col"] + 0.5) * k, (lm["row"] + 0.5) * k
        d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(20, 20, 20), outline=(255, 255, 255))
        d.text((x + 6, y - 5), lm["name"][:18], fill=(20, 20, 20))
    d.text((4, rows * k - 12), label, fill=(20, 20, 20))
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def heat_map(block: Block) -> bytes:
    lo, hi = float(block.lst.min()), float(block.lst.max())
    rgb = _ramp((block.lst - lo) / max(hi - lo, 0.1))
    rgb = np.where((block.building_frac > 0.5)[..., None], rgb * 0.6, rgb)       # buildings darker: the heat shown is the ground's
    return _frame(rgb, block, f"surface heat {lo:.0f}-{hi:.0f} C (blue cool, red hot); dark = buildings")


def canopy_map(block: Block) -> bytes:
    cap = plantable.capacity_grid(block, species_mod.get(None))
    rgb = np.full(block.lst.shape + (3,), 235.0)                                  # open ground, no room for a tree
    rgb[cap >= 1] = (205, 235, 190)                                               # a tree can go here
    rgb[block.carriageway >= 0.5] = (110, 110, 110)                               # carriageway
    rgb[block.building_frac >= 0.5] = (170, 150, 130)                             # buildings
    shade = np.clip(block.canopy_frac / 0.7, 0, 1)[..., None]
    rgb = rgb * (1 - shade) + np.array([30, 120, 50]) * shade                     # existing canopy
    return _frame(rgb, block, "green = existing trees, light green = room to plant, grey = road, brown = buildings")
