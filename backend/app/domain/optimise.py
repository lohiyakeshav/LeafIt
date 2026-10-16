"""Greedy budget optimiser (PRD §9): repeatedly buy the placement with the best marginal cooling per rupee."""
import numpy as np
from scipy.ndimage import convolve

from .sim import COOLING_CAP_C, KERNELS, MAX_TREES_PER_CELL, RULES, TYPES, Block, maturity

MAX_STEPS = 3000  # ponytail: one item per step; batch picks if blocks get much larger than ~100x100


FOCUS_RADIUS_CELLS = 8  # ~80 m around a landmark the user cares about
FOCUS_BOOST = 4


def _weights(block: Block, goal: str, focus):
    if goal == "hotspots":  # cool the hottest outdoor cells, where people are
        w = np.clip(block.lst - np.median(block.lst[block.outdoor]), 0, None) * block.outdoor
    else:
        w = block.outdoor.astype(float)  # "average": street-level cooling, where people are
    if focus:
        y, x = np.indices(block.lst.shape)
        near = sum(np.exp(-((y - r) ** 2 + (x - c) ** 2) / (2 * FOCUS_RADIUS_CELLS ** 2)) for r, c in focus)
        w = (w + 0.1) * (1 + FOCUS_BOOST * near)  # +0.1 so cool-but-busy places near a landmark still count
    return w


def optimise(block: Block, budget: float, goal: str = "average", years: int = 10,
             types=("tree", "cool_roof"), focus=()) -> list[dict]:
    """Shaded bus stops are left out: they cut exposure, not °C, so they can't be ranked on the same scale."""
    grown = maturity(years)
    shape = block.lst.shape
    w = _weights(block, goal, focus)
    classes = block.meta["landcover_classes"]
    water = block.landcover == classes.index("water") if "water" in classes else np.zeros(shape, bool)

    trees = np.zeros(shape)
    roofs = np.zeros(shape, bool)
    per_unit = {"tree": np.full(shape, grown), "cool_roof": block.building_frac}
    unit_cost = {"tree": np.full(shape, float(TYPES["tree"]["cost"])),
                 "cool_roof": np.where(block.roof_area > 0, block.roof_area * TYPES["cool_roof"]["cost"], np.inf)}
    left = float(budget)

    for _ in range(MAX_STEPS):
        raw = (TYPES["tree"]["cool_c"] * convolve(trees * grown, KERNELS["tree"], mode="constant")
               + TYPES["cool_roof"]["cool_c"] * convolve(roofs * block.building_frac, KERNELS["cool_roof"], mode="constant"))
        g = w * np.exp(-raw / COOLING_CAP_C)  # derivative of the saturating cooling curve
        allowed = {"tree": (block.building_frac < RULES["tree"]["blocked_building_frac_from"]) & ~water & (trees < MAX_TREES_PER_CELL),
                   "cool_roof": (block.roof_area > 0) & ~roofs}
        best = None
        for t in types:
            gain = TYPES[t]["cool_c"] * per_unit[t] * convolve(g, KERNELS[t], mode="constant")  # symmetric kernel
            score = np.where(allowed[t] & (unit_cost[t] <= left), gain / unit_cost[t], -1.0)
            i = int(score.argmax())
            if score.flat[i] > 0 and (best is None or score.flat[i] > best[0]):
                best = (score.flat[i], t, i)
        if best is None:
            break
        _, t, i = best
        r, c = divmod(i, shape[1])
        left -= unit_cost[t][r, c]
        if t == "tree":
            trees[r, c] += 1
        else:
            roofs[r, c] = True

    plan = [{"type": "tree", "row": int(r), "col": int(c), "count": int(trees[r, c])} for r, c in np.argwhere(trees)]
    return plan + [{"type": "cool_roof", "row": int(r), "col": int(c)} for r, c in np.argwhere(roofs)]
