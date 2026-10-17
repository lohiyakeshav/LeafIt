"""Budgeted placement (PRD §9): repeatedly buy the item with the best marginal benefit per rupee.

The benefit is  Σ_cells w · cap·e^(−existing/cap)·(1 − e^(−new/cap)), the weighted street cooling that the new items add on
top of the shade already there. That is a concave function of a non-negative linear one, so it is monotone submodular; under
a budget, taking the better of (cost-benefit greedy, best single affordable item) is guaranteed at least ½(1−1/e) ≈ 0.316 of
the optimum (Krause & Guestrin 2005). In practice greedy is far closer: tests measure it against brute force. The guarantee
covers the budget and per-cell capacity limits; the humid-climate density rule is an extra feasibility filter, so no
guarantee is claimed when it is active.

Speed: after each purchase only the neighbourhood it changes is recomputed, so a 100 × 100 area takes well under a second.
"""
import numpy as np
from scipy.ndimage import convolve, maximum_filter

from app.domain import canopy, plantable, zones
from app.domain import species as species_mod
from app.domain.sim import COOLING_CAP_C, KERNELS, TYPES, Block, prices

MAX_STEPS = 3000
FOCUS_RADIUS_CELLS = 8   # ~80 m around a landmark the user cares about
FOCUS_BOOST = 4
ZONE_BOOST = 10          # a focus zone counts this many times more: decisive, so "focus here" really means here first
PEOPLE_KINDS = ("school", "clinic", "bus stop", "market")
POI_SIGMA_CELLS = 5
LOW_VALUE_BELOW = 0.5    # a tree is "low value" if it adds less than half of what it would on bare ground
STOP_LIMIT = 5
STOP_BUDGET_SHARE = 0.4  # shelters never take more than this share of the budget ...
ONE_STOP_SHARE = 0.5     # ... except that one shelter is allowed when it costs at most half (a ₹10 lakh shelter on a ₹20 lakh budget)
MAX_ROOF_SHARE = 0.6     # cool roofs for homes may take at most this share (the rest still goes to street cooling)
BUS_STOP_REACH = 2       # a shelter for a mapped bus stop goes on a road cell within this many cells of it

K_TREE, K_ROOF = KERNELS["tree"], KERNELS["cool_roof"]
R_TREE, R_ROOF = K_TREE.shape[0] // 2, K_ROOF.shape[0] // 2


def value_ratio(block: Block) -> np.ndarray:
    """How much of its bare-ground value a new tree keeps at each cell: 1 on open ground, → 0 deep inside existing shade."""
    return np.exp(-block.existing[0] / COOLING_CAP_C)


def _poi(block: Block) -> np.ndarray:
    """Pull towards the places people gather (schools, clinics, bus stops, markets): 0 far away, → 1 at them."""
    rows, cols = block.lst.shape
    y, x = np.indices((rows, cols))
    near = np.zeros((rows, cols))
    for lm in block.meta.get("landmarks", []):
        if lm["kind"] in PEOPLE_KINDS:
            near = np.maximum(near, np.exp(-((y - lm["row"]) ** 2 + (x - lm["col"]) ** 2) / (2 * POI_SIGMA_CELLS**2)))
    return near


def weights(block: Block, goal: str, focus=(), focus_zones=(), avoid_zones=()) -> np.ndarray:
    """What a degree of cooling is worth at each cell, for this goal. Zero where nobody is (indoors) or the plan must keep out."""
    rows, cols = block.lst.shape
    out = block.outdoor
    if goal == "hotspots":   # cool the hottest outdoor cells
        w = np.clip(block.lst - np.median(block.lst[out]), 0, None) * out
    elif goal in ("people", "vulnerable"):
        expo = block.exposure if block.exposure is not None and block.exposure.max() > 0 else None
        if goal == "vulnerable" and expo is not None:
            w = out * (0.05 + expo / expo.max())
        else:
            w = out * (0.2 + (expo / expo.max() if expo is not None else 0.0)) * (1 + 2 * _poi(block))
    else:                    # "average": street-level cooling where people are
        w = out.astype(float)
    if focus:
        y, x = np.indices((rows, cols))
        near = sum(np.exp(-((y - r) ** 2 + (x - c) ** 2) / (2 * FOCUS_RADIUS_CELLS ** 2)) for r, c in focus)
        w = (w + 0.1) * (1 + FOCUS_BOOST * near)  # +0.1 so cool-but-busy places near a landmark still count
    if focus_zones:
        w = np.where(zones.mask(rows, cols, focus_zones), w * ZONE_BOOST, w)
    if avoid_zones:
        w = np.where(zones.mask(rows, cols, avoid_zones), 0.0, w)
    return w


MAX_SPECIES_SHARE = 0.3   # no species above 30% of an auto-chosen plan (Santamour's 10-20-30 rule caps a family at 30%)


def _diversify(trees: np.ndarray, sp_idx: np.ndarray, effect: np.ndarray, cap: np.ndarray, crown_m2=None) -> np.ndarray:
    """Species per planted cell so no species holds more than MAX_SPECIES_SHARE of the trees.

    The single best species for every cell would make a near-monoculture (one pest or disease could take the plan). Trees
    are moved, a cell at a time, from over-represented species to the best alternative that fits the cell (capacity for
    that many trees) and has room under the cap, cheapest loss of shade first. The plan's numbers are then simulated with
    the final species, so nothing is claimed for the swap. If the cap can't be met (too few species fit), it gets as close
    as it can (the plan check reports the real share). With `crown_m2` (humid climates) a tree only moves to an equal or
    smaller crown, so the airflow rule still holds.
    """
    sp_idx = sp_idx.copy()
    rc = np.argwhere(trees > 0)
    total = int(trees.sum())
    if len(effect) < 2 or not total:
        return sp_idx
    limit = max(1, int(np.ceil(MAX_SPECIES_SHARE * total)))
    count = np.bincount(sp_idx[rc[:, 0], rc[:, 1]], weights=trees[rc[:, 0], rc[:, 1]], minlength=len(effect)).astype(int)
    for k in np.argsort(-count):                       # most over-represented species first
        if count[k] <= limit:
            continue
        mine = rc[sp_idx[rc[:, 0], rc[:, 1]] == k]
        n = trees[mine[:, 0], mine[:, 1]]
        fits = cap[:, mine[:, 0], mine[:, 1]] >= n     # (species, cells): could this species hold the cell's trees?
        if crown_m2 is not None:
            fits &= (np.asarray(crown_m2) <= crown_m2[k])[:, None]
        fits[k] = False
        loss = np.where(fits, (effect[k, mine[:, 0], mine[:, 1]] - effect[:, mine[:, 0], mine[:, 1]]) / np.maximum(effect[k, mine[:, 0], mine[:, 1]], 1e-9), np.inf)
        for i in np.argsort(loss.min(axis=0)):          # cells where swapping costs least shade first
            if count[k] <= limit:
                break
            for j in np.argsort(loss[:, i]):
                if np.isfinite(loss[j, i]) and count[j] + n[i] <= limit:
                    r, c = mine[i]
                    sp_idx[r, c] = j
                    count[k] -= n[i]
                    count[j] += n[i]
                    break
    return sp_idx


def choose_species(block: Block, years: int, species: str | None):
    """Per cell: (effect per tree, capacity, species index) for the chosen species, or the best-fitting one for each cell.

    species None → the generic tree everywhere (the model's baseline); a catalogue id → that species; "auto" → at each cell
    the species whose fully planted cell shades most at this horizon, among those that suit the climate (optimise() then
    mixes species so none dominates, see _diversify).
    """
    catalogue = list(species_mod.BY_ID.values())
    if species == "auto":
        cls = block.meta.get("climate", {}).get("class")
        pool = [s for s in catalogue if s["id"] != species_mod.DEFAULT and species_mod.suits(s, cls)] or [species_mod.get(None)]
    else:
        pool = [species_mod.get(species)]
    effect, cap = species_table(block, years, pool)
    best = (effect * cap).argmax(axis=0)
    pick = lambda a: np.take_along_axis(a, best[None], 0)[0]  # noqa: E731
    return pick(effect), pick(cap), best, pool


def species_table(block: Block, years: int, pool: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """(effect per tree, capacity) for every species in `pool`, each shaped (species, rows, cols)."""
    effect = np.stack([species_mod.crown_ratio(s) * species_mod.maturity(s, years) * np.ones(block.lst.shape) for s in pool])
    return effect, np.stack([plantable.capacity_grid(block, s) for s in pool])


class _Plan:
    """Mutable state of one greedy run, with incremental updates."""

    def __init__(self, block: Block, w: np.ndarray, per_tree: np.ndarray, cap_cell: np.ndarray):
        self.block, self.w = block, w
        self.rows, self.cols = block.lst.shape
        self.Re = block.existing[0]
        self.Rn = np.zeros_like(w)
        self.g = w * np.exp(-self.Re / COOLING_CAP_C)
        self.per_tree, self.cap_cell = per_tree, cap_cell
        self.trees = np.zeros(w.shape, int)
        self.roofs = np.zeros(w.shape, bool)
        self.gain_tree = TYPES["tree"]["cool_c"] * convolve(self.g, K_TREE, mode="constant")
        self.gain_roof = TYPES["cool_roof"]["cool_c"] * convolve(self.g, K_ROOF, mode="constant")

    def _spread(self, r, c, K, amount):
        rad = K.shape[0] // 2
        r0, r1, c0, c1 = max(r - rad, 0), min(r + rad + 1, self.rows), max(c - rad, 0), min(c + rad + 1, self.cols)
        self.Rn[r0:r1, c0:c1] += amount * K[r0 - r + rad:r1 - r + rad, c0 - c + rad:c1 - c + rad]

    def _refresh(self, r, c, reach):
        """g changed within `reach` of (r, c): recompute g there, then both gain maps within reach + their kernel radius."""
        r0, r1, c0, c1 = max(r - reach, 0), min(r + reach + 1, self.rows), max(c - reach, 0), min(c + reach + 1, self.cols)
        self.g[r0:r1, c0:c1] = self.w[r0:r1, c0:c1] * np.exp(-(self.Re[r0:r1, c0:c1] + self.Rn[r0:r1, c0:c1]) / COOLING_CAP_C)
        for gain, K, cool_c in ((self.gain_tree, K_TREE, TYPES["tree"]["cool_c"]), (self.gain_roof, K_ROOF, TYPES["cool_roof"]["cool_c"])):
            rad = K.shape[0] // 2
            a0, a1, b0, b1 = max(r0 - rad, 0), min(r1 + rad, self.rows), max(c0 - rad, 0), min(c1 + rad, self.cols)
            sub = convolve(self.g[a0:a1, b0:b1], K, mode="constant")
            gain[r0:r1, c0:c1] = cool_c * sub[r0 - a0:r1 - a0, c0 - b0:c1 - b0]

    def buy_tree(self, r, c):
        self.trees[r, c] += 1
        self._spread(r, c, K_TREE, TYPES["tree"]["cool_c"] * self.per_tree[r, c])
        self._refresh(r, c, R_TREE)

    def buy_roof(self, r, c):
        self.roofs[r, c] = True
        self._spread(r, c, K_ROOF, TYPES["cool_roof"]["cool_c"] * self.block.building_frac[r, c])
        self._refresh(r, c, R_ROOF)

    def objective(self) -> float:
        return float((self.w * canopy.marginal(self.Re, self.Rn, COOLING_CAP_C)).sum())


def _plan_objective(block, w, per_tree, trees=None, roofs=None) -> float:
    """Benefit of a given set of purchases (used to compare greedy with the best single item)."""
    raw = np.zeros_like(w)
    if trees is not None:
        raw += TYPES["tree"]["cool_c"] * convolve(trees * per_tree, K_TREE, mode="constant")
    if roofs is not None:
        raw += TYPES["cool_roof"]["cool_c"] * convolve(roofs * block.building_frac, K_ROOF, mode="constant")
    return float((w * canopy.marginal(block.existing[0], raw, COOLING_CAP_C)).sum())


def optimise(block: Block, budget: float, goal: str = "average", years: int = 10, types=("tree", "cool_roof"), focus=(),
             unit_cost: dict | None = None, *, species: str | None = None, focus_zones=(), avoid_zones=(), max_trees: int | None = None,
             avoid_shaded: bool = False, include_shade_stops: bool = False, roof_share: float = 0.0) -> list[dict]:
    """Best plan within `budget`.

    Shaded bus stops and cool roofs on homes serve people in ways street cooling does not measure (shade while waiting; cooler
    rooms below the roof), so they can't be ranked against trees on one scale. When asked for, shelters are reserved first (at
    most 40% of the budget, or one shelter if it costs at most half), then cool roofs for the homes with the most residents (`roof_share`, at most 60%), and the trees and
    any further roofs are optimised for street cooling with the rest.
    """
    price = prices(unit_cost)
    stop_money = max(budget * STOP_BUDGET_SHARE, price["shade_stop"] if price["shade_stop"] <= budget * ONE_STOP_SHARE else 0.0)
    stops = _shade_stops(block, stop_money, price["shade_stop"], avoid_zones) if include_shade_stops else []
    budget = budget - len(stops) * price["shade_stop"]
    homes = _home_roofs(block, budget * min(max(roof_share, 0.0), MAX_ROOF_SHARE), price["cool_roof"], goal, focus_zones, avoid_zones)
    budget = budget - sum(float(block.roof_area[p["row"], p["col"]]) * price["cool_roof"] for p in homes)
    w = weights(block, goal, focus, focus_zones, avoid_zones)
    per_tree, cap_cell, sp_idx, pool = choose_species(block, years, species)
    rows, cols = block.lst.shape
    p = _Plan(block, w, per_tree, cap_cell)

    tree_ok = (cap_cell > 0) & (w > 0)
    if avoid_shaded:
        tree_ok &= value_ratio(block) >= LOW_VALUE_BELOW
    roof_cost = np.where(block.roof_area > 0, block.roof_area * price["cool_roof"], np.inf)
    roof_ok = (block.roof_area > 0) & (w > 0)
    for h in homes:   # already coated for the residents below
        roof_ok[h["row"], h["col"]] = False
    crown = np.vectorize(lambda i: species_mod.crown_m2(pool[i]))(sp_idx) if block.humid else None
    planned = np.zeros((rows, cols))
    banned = np.zeros((rows, cols), bool)
    left, bought, steps = float(budget), 0, 0

    while steps < MAX_STEPS:
        steps += 1
        best = None
        if "tree" in types and price["tree"] <= left and (max_trees is None or bought < max_trees):
            ok = tree_ok & (p.trees < cap_cell) & ~banned
            score = np.where(ok, p.gain_tree * per_tree / price["tree"], -1.0)
            i = int(score.argmax())
            if score.flat[i] > 0:
                best = (float(score.flat[i]), "tree", i)
        if "cool_roof" in types:
            ok = roof_ok & ~p.roofs & (roof_cost <= left)
            score = np.where(ok, p.gain_roof * block.building_frac / np.where(np.isinf(roof_cost), 1.0, roof_cost), -1.0)
            i = int(score.argmax())
            if score.flat[i] > 0 and (best is None or score.flat[i] > best[0]):
                best = (float(score.flat[i]), "cool_roof", i)
        if best is None:
            break
        _, t, i = best
        r, c = divmod(i, cols)
        if t == "tree":
            if crown is not None:   # humid climate: never pack more than half of a ~30 m window with crown
                planned[r, c] += crown[r, c]
                lim = plantable.humid_limit_m2(block)
                if maximum_filter(plantable.window_canopy_m2(block, planned), size=3)[r, c] > lim + 1e-6:
                    planned[r, c] -= crown[r, c]
                    banned[r, c] = True
                    continue
            p.buy_tree(r, c)
            left -= price["tree"]
            bought += 1
        else:
            p.buy_roof(r, c)
            left -= roof_cost[r, c]

    greedy_value = p.objective()
    single = _best_single(block, w, per_tree, cap_cell, tree_ok & ~banned, roof_ok, roof_cost, price, budget, types, max_trees)
    if single is not None and single[0] > greedy_value:   # Krause & Guestrin: the better of the two keeps the guarantee
        kind, (r, c) = single[1], single[2]
        trees_grid = np.zeros((rows, cols), int)
        roofs_grid = np.zeros((rows, cols), bool)
        if kind == "tree":
            trees_grid[r, c] = 1
        else:
            roofs_grid[r, c] = True
        plan_trees, plan_roofs = trees_grid, roofs_grid
    else:
        plan_trees, plan_roofs = p.trees, p.roofs

    if species == "auto":
        sp_idx = _diversify(plan_trees, sp_idx, *species_table(block, years, pool),
                            crown_m2=[species_mod.crown_m2(sp) for sp in pool] if block.humid else None)
    plan = [{"type": "tree", "row": int(r), "col": int(c), "count": int(plan_trees[r, c]), "species": pool[sp_idx[r, c]]["id"]}
            for r, c in np.argwhere(plan_trees)]
    plan += [{"type": "cool_roof", "row": int(r), "col": int(c)} for r, c in np.argwhere(plan_roofs)]
    return plan + homes + stops


def _home_roofs(block: Block, left: float, m2_cost: float, goal: str, focus_zones=(), avoid_zones=()) -> list[dict]:
    """Cool roofs within `left` on the roofs that shelter the most residents per rupee (vulnerable residents for that goal).

    Without population data the hottest roofs are used instead (most roof-surface heat taken out per rupee). Focus zones
    come first; avoided zones get none.
    """
    if left <= 0:
        return []
    cost = block.roof_area * m2_cost
    people = block.vulnerable if goal == "vulnerable" and block.vulnerable is not None else block.population
    value = people.astype(float) if people is not None else np.clip(block.lst - np.median(block.lst), 0, None) * block.roof_area
    rows, cols = block.lst.shape
    zone = np.array([[zones.zone_of(r, c, rows, cols) for c in range(cols)] for r in range(rows)])
    value = np.where(np.isin(zone, list(avoid_zones)), 0.0, value)
    value = np.where(np.isin(zone, list(focus_zones)), value * ZONE_BOOST, value)
    score = np.where((block.roof_area > 0) & (value > 0), value / np.where(cost > 0, cost, np.inf), -1.0)
    out = []
    for i in np.argsort(score, axis=None)[::-1]:
        r, c = divmod(int(i), cols)
        if score[r, c] <= 0:
            break
        if cost[r, c] <= left:
            out.append({"type": "cool_roof", "row": r, "col": c})
            left -= cost[r, c]
    return out


def _best_single(block, w, per_tree, cap_cell, tree_ok, roof_ok, roof_cost, price, budget, types, max_trees):
    """The best single affordable item (exactly evaluated among the top candidates of each type), or None."""
    best = None
    p = _Plan(block, w, per_tree, cap_cell)
    for kind, ok, gain, cost in (
            ("tree", tree_ok & (cap_cell > 0), p.gain_tree * per_tree, price["tree"]),
            ("cool_roof", roof_ok, p.gain_roof * block.building_frac, roof_cost)):
        if kind not in types or (kind == "tree" and max_trees is not None and max_trees < 1):
            continue
        afford = ok & (np.asarray(cost) <= budget)
        if not afford.any():
            continue
        for i in np.argsort(np.where(afford, gain, -np.inf), axis=None)[::-1][:12]:
            r, c = divmod(int(i), w.shape[1])
            if not afford[r, c]:
                break
            trees = np.zeros(w.shape, int)
            roofs = np.zeros(w.shape, bool)
            (trees if kind == "tree" else roofs)[r, c] = 1
            v = _plan_objective(block, w, per_tree, trees, roofs)
            if best is None or v > best[0]:
                best = (v, kind, (r, c))
    return best


def _shade_stops(block: Block, left: float, stop_cost: float, avoid_zones=()) -> list[dict]:
    """Bus-stop shelters within `left`: first at the mapped bus stops (the hottest road cell next to each), then at the hottest
    road cells where people gather (schools, clinics, markets)."""
    n = min(STOP_LIMIT, int(left // stop_cost))   # `left` is the budget the shelters may use
    if n < 1:
        return []
    rows, cols = block.lst.shape
    classes = block.meta["landcover_classes"]
    road = block.landcover == classes.index("road") if "road" in classes else np.zeros(block.lst.shape, bool)
    zone = np.array([[zones.zone_of(r, c, rows, cols) for c in range(cols)] for r in range(rows)])
    road &= ~np.isin(zone, list(avoid_zones))
    heat = block.lst - block.lst[block.outdoor].min()
    out, taken = [], set()
    for lm in sorted((lm for lm in block.meta.get("landmarks", []) if lm["kind"] == "bus stop"), key=lambda lm: -heat[lm["row"], lm["col"]]):
        k = BUS_STOP_REACH
        r0, c0 = max(lm["row"] - k, 0), max(lm["col"] - k, 0)
        near = np.where(road[r0:lm["row"] + k + 1, c0:lm["col"] + k + 1], heat[r0:lm["row"] + k + 1, c0:lm["col"] + k + 1], -np.inf)
        if len(out) < n and np.isfinite(near.max()):
            r, c = np.unravel_index(int(near.argmax()), near.shape)
            cell = (int(r0 + r), int(c0 + c))
            if cell not in taken:
                taken.add(cell)
                out.append({"type": "shade_stop", "row": cell[0], "col": cell[1]})
    score = np.where(road, heat * (0.2 + _poi(block)), -np.inf)
    for i in np.argsort(score, axis=None)[::-1]:
        if len(out) >= n:
            break
        r, c = divmod(int(i), cols)
        if np.isfinite(score[r, c]) and (r, c) not in taken:
            taken.add((r, c))
            out.append({"type": "shade_stop", "row": r, "col": c})
    return out
