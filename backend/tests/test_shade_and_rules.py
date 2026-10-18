"""The v2 cooling model: shade that already exists, the 150 m ring, species, air cooling, where trees may go, and the optimiser's
guarantee. Every test runs offline on the sample block, modified through the same fields real areas carry."""
import itertools
import json

import numpy as np
import pytest

from app.config import BLOCKS_DIR
from app.domain import optimise as opt
from app.domain import plantable
from app.domain import species as species_mod
from app.domain.sim import AIR, AIR_KERNEL, COOLING_CAP_C, KERNELS, TREE_LOW_SHARE, TYPES, Block, evaluate, simulate

# The real sample with its v2 layers taken off: each test then adds exactly the canopy, ring, roads or people it is about, so
# the effect under test isn't mixed with the sample's own (the real heat, buildings and land cover stay).
SAMPLE = json.loads((BLOCKS_DIR / "lajpat_nagar.json").read_text())
V2_LAYERS = ("ring", "canopy_frac", "canopy_h", "carriageway_frac", "population", "vulnerable", "exposure", "population_total")
RAW = {k: v for k, v in SAMPLE.items() if k not in V2_LAYERS}
ROWS, COLS = RAW["rows"], RAW["cols"]
RAW.update(canopy_frac=np.zeros((ROWS, COLS)).tolist(), canopy_h=np.zeros((ROWS, COLS)).tolist())   # no existing shade unless a test adds it
GENERIC = species_mod.get(None)


def blk(**overrides) -> Block:
    return Block.from_dict({**RAW, **overrides})


def grid(value, rows=ROWS, cols=COLS):
    return np.full((rows, cols), value, float)


@pytest.fixture(scope="module")
def spot():
    """The centre of a 3 × 3 patch of open ground (at least 80 m² of each cell free), where trees may go."""
    b = blk()
    ok = (plantable.capacity_grid(b, GENERIC) >= 1) & (plantable.free_m2(b) >= 80)
    return next((int(r), int(c)) for r in range(2, ROWS - 2) for c in range(2, COLS - 2) if ok[r - 1:r + 2, c - 1:c + 2].all())   # 2 cells from the edge: tests shade a 5×5 around it


# ── species ──────────────────────────────────────────────────────────────────────────────────────
def test_the_generic_tree_is_exactly_the_original_model():
    assert species_mod.crown_m2(GENERIC) == 50 and species_mod.crown_ratio(GENERIC) == 1
    assert abs(species_mod.maturity(GENERIC, 10) - 0.57) < 0.01      # the sourced 57% at year 10


def test_bigger_crowns_shade_more_and_fit_fewer(spot):
    r, c = spot
    peepal, amaltas = species_mod.get("peepal"), species_mod.get("amaltas")
    assert species_mod.crown_m2(peepal) > species_mod.crown_m2(GENERIC) > species_mod.crown_m2(amaltas)
    b = blk()
    assert plantable.capacity_grid(b, peepal)[r, c] == 1 < plantable.capacity_grid(b, amaltas)[r, c]
    one = lambda sp: simulate(b, [{"type": "tree", "row": r, "col": c, "species": sp}], 30)["metrics"]["peak_reduction_c"]
    assert one("amaltas") < one(None) < one("peepal")


def test_every_species_has_a_source_or_is_flagged_an_estimate():
    for s in species_mod.SPECIES["species"]:
        assert s["listed_in"] or s["status"] in ("default", "estimate"), s["id"]
        assert all(k in species_mod.SPECIES["sources"] for k in s["listed_in"]), s["id"]
        assert s["size_class"] in species_mod.SPECIES["size_classes"] and s["growth"] in species_mod.SPECIES["growth_tau_years"]
    assert species_mod.get("pongamia")["climates"] == ["composite", "humid"]      # not on Delhi's list: not tagged hot-dry


# ── existing shade, and the ring ────────────────────────────────────────────────────────────────
def test_a_tree_beside_existing_shade_adds_less(spot):
    r, c = spot
    near = grid(0.0)
    near[r - 2:r + 3, c - 2:c + 3] = 0.5
    near[r, c] = 0.3                      # the cell itself stays plantable
    shade, height = near.tolist(), grid(9.0).tolist()
    place = [{"type": "tree", "row": r, "col": c}]
    bare = simulate(blk(), place, 30)["metrics"]["peak_reduction_c"]
    shaded = simulate(blk(canopy_frac=shade, canopy_h=height), place, 30)["metrics"]["peak_reduction_c"]
    assert shaded < 0.7 * bare            # existing canopy already removed much of the heat


def test_low_canopy_is_not_shade():
    """Shrubs and lawns (under 2 m) must not count as tree shade, and trees of 8 m or more count in full."""
    b = blk(canopy_frac=grid(0.5).tolist(), canopy_h=grid(1.0).tolist())
    assert b.existing_equiv.max() == 0
    b = blk(canopy_frac=grid(0.5).tolist(), canopy_h=grid(8.0).tolist())
    assert abs(b.existing_equiv[0, 0] - 0.5 * 100 / 50) < 1e-9


def test_a_park_just_outside_the_box_lowers_the_value_of_trees_at_the_edge():
    b0 = blk()
    edge = next((int(r), int(c)) for r, c in np.argwhere(plantable.capacity_grid(b0, GENERIC) >= 1) if r <= 2 and 10 < c < 50)
    pad = 6
    park = np.zeros((ROWS + 2 * pad, COLS + 2 * pad))
    park[:pad, :] = 0.7                   # a belt of canopy along the whole north side, outside the box
    ring = {"pad": pad, "canopy_frac": park.tolist(), "canopy_h": (park * 10 / 0.7).tolist()}
    place = [{"type": "tree", "row": edge[0], "col": edge[1]}]
    plain = simulate(b0, place, 30)["metrics"]["peak_reduction_c"]
    beside_park = simulate(blk(ring=ring), place, 30)["metrics"]["peak_reduction_c"]
    assert beside_park < plain
    far = next((int(r), int(c)) for r, c in np.argwhere(plantable.capacity_grid(b0, GENERIC) >= 1) if 30 < r < 40 and 25 < c < 40)
    far_place = [{"type": "tree", "row": far[0], "col": far[1]}]
    a, b = (simulate(x, far_place, 30)["metrics"] for x in (blk(ring=ring), b0))
    assert abs(a["temp_reduction_c"] - b["temp_reduction_c"]) < 1e-3 and a["peak_reduction_c"] == b["peak_reduction_c"]   # far from the park: unaffected


def test_without_existing_shade_the_marginal_formula_is_the_original_curve():
    ev = evaluate(blk(), [{"type": "tree", "row": 5, "col": 5, "count": 2}], 10)
    k0 = KERNELS["tree"][KERNELS["tree"].shape[0] // 2, KERNELS["tree"].shape[1] // 2]   # the tree's own cell's share
    raw = TYPES["tree"]["cool_c"] * 2 * 0.5654 * k0
    assert ev.street.max() > 0 and abs(ev.street.max() - COOLING_CAP_C * (1 - np.exp(-raw / COOLING_CAP_C))) < 1e-3


# ── air cooling ──────────────────────────────────────────────────────────────────────────────────
def test_air_cools_less_than_the_surface_and_never_exceeds_its_cap(cells):
    for n in (10, 100, 600):
        ev = evaluate(blk(), cells.trees(n), 30)
        assert 0 < ev.air.max() < 1.5 and ev.air.mean() < ev.street.mean()


def test_calibration_matches_the_cited_studies():
    """Uniform canopy, far from the edges: the numbers the Method page cites must come out of the model."""
    from scipy.ndimage import convolve

    from app.domain import canopy
    def centre(per_tree, kernel, cap, cover):            # cover = share of each 10 m cell under 50 m² crowns
        units = np.full((41, 41), cover * 2)
        return canopy.marginal(0, per_tree * convolve(units, kernel, mode="constant")[20, 20], cap)
    high = lambda cover: centre(TYPES["tree"]["cool_c"], KERNELS["tree"], COOLING_CAP_C, cover)
    low = lambda cover: centre(TYPES["tree"]["cool_c"] * TREE_LOW_SHARE, KERNELS["tree"], COOLING_CAP_C, cover)
    air = lambda cover: centre(AIR["per_tree_c"], AIR_KERNEL, AIR["cap_c"], cover)
    assert abs(low(0.5) - 0.268) < 0.015                 # Ruiz-Valero et al. 2026: half canopy → 0.268 °C surface
    assert 1.0 < high(0.5) < 2.0 and high(1.0) < 4.0     # Schwaab et al. 2021: tree vs built-up surfaces 0–4 °C (southern Europe)
    assert abs(air(1.0) - 1.0) < 0.05                    # Bowler et al. 2010: parks ~1 °C cooler air


# ── where trees may go: one reason, in a fixed order ────────────────────────────────────────────
def _reason(b, r, c, count=1, sp=None):
    return plantable.block_reason(b, species_mod.get(sp), r, c, count)


def test_rules_report_only_the_first_blocking_reason():
    b = blk(carriageway_frac=grid(0.6).tolist(), canopy_frac=grid(0.7).tolist(), canopy_h=grid(9).tolist())
    assert "carriageway" in _reason(b, 5, 5)                                  # carriageway wins over shade
    b = blk(canopy_frac=grid(0.7).tolist(), canopy_h=grid(9).tolist(), building_frac=grid(0.9).tolist())
    assert "No room" in _reason(b, 5, 5)                                      # a building wins over shade
    b = blk(canopy_frac=grid(0.7).tolist(), canopy_h=grid(9).tolist())
    assert "shaded" in _reason(b, 5, 5)
    b = blk(carriageway_frac=grid(0.0).tolist(), building_frac=grid(0.0).tolist())
    assert _reason(b, 5, 5, count=2) is None and "Only 2 trees fit" in _reason(b, 5, 5, count=3)
    assert "Only 1 tree fits" in _reason(b, 5, 5, count=2, sp="peepal")


def test_carriageway_cells_never_take_trees_but_footpath_edges_do():
    b = blk(carriageway_frac=np.linspace(0, 1, ROWS * COLS).reshape(ROWS, COLS).tolist())
    cap = plantable.capacity_grid(b, GENERIC)
    assert (cap[b.carriageway >= 0.5] == 0).all() and (cap[b.carriageway < 0.3] >= 1).any()
    bad = int(np.argwhere(b.carriageway >= 0.5)[0][0]), int(np.argwhere(b.carriageway >= 0.5)[0][1])
    with pytest.raises(ValueError, match="carriageway"):
        simulate(b, [{"type": "tree", "row": bad[0], "col": bad[1]}])


def test_several_placements_in_one_cell_share_its_capacity(spot):
    r, c = spot
    simulate(blk(), [{"type": "tree", "row": r, "col": c}] * 2)               # capacity 2: fine
    with pytest.raises(ValueError, match="fit"):
        simulate(blk(), [{"type": "tree", "row": r, "col": c}] * 3)


def test_humid_climates_limit_how_much_of_a_30_m_window_crowns_may_fill(spot):
    r, c = spot
    nine = [{"type": "tree", "row": r + i, "col": c + j} for i in (-1, 0, 1) for j in (-1, 0, 1)]    # 9 × 50 m² = 450 m² = half of 900
    humid = blk(climate={"class": "humid"})
    simulate(humid, nine)                                                     # right at the limit: allowed
    simulate(blk(), nine + [{"type": "tree", "row": r, "col": c}])            # dry climate: no density rule
    with pytest.raises(ValueError, match="humid"):
        simulate(humid, nine + [{"type": "tree", "row": r, "col": c}])


def test_old_blocks_without_the_new_fields_still_load_and_simulate():
    legacy = {k: v for k, v in RAW.items() if k not in ("canopy_frac", "canopy_h", "carriageway_frac", "climate", "schema_version")}
    b = Block.from_dict(legacy)
    assert b.canopy_frac.max() == 0 and b.carriageway.max() == 0.45 and not b.humid
    assert simulate(b, [])["metrics"]["temp_reduction_c"] == 0


def test_equity_metric_needs_population_and_rewards_serving_the_exposed(cells):
    assert simulate(blk(), cells.trees(20))["metrics"]["equity_cooling_c"] is None
    yy, xx = np.indices((ROWS, COLS))
    expo = np.exp(-((yy - 45) ** 2 + (xx - 45) ** 2) / (2 * 8**2))
    b = blk(exposure=expo.tolist())
    near = [{"type": "tree", "row": int(r), "col": int(c)} for r, c in cells.open if abs(r - 45) < 9 and abs(c - 45) < 9][:20]
    far = [{"type": "tree", "row": int(r), "col": int(c)} for r, c in cells.open if r < 15 and c < 15][:20]
    assert simulate(b, near)["metrics"]["equity_cooling_c"] > 3 * simulate(b, far)["metrics"]["equity_cooling_c"]


# ── optimiser ────────────────────────────────────────────────────────────────────────────────────
def _trees_in(plan):
    return [p for p in plan if p["type"] == "tree"]


def test_optimiser_plans_are_always_valid_and_inside_budget(block):
    for kw in ({}, {"species": "auto"}, {"goal": "people"}, {"goal": "hotspots", "avoid_shaded": True}):
        plan = opt.optimise(block, 1_200_000, years=10, **kw)
        assert plan and simulate(block, plan)["metrics"]["total_cost_inr"] <= 1_200_000


def test_optimiser_respects_avoid_zones_max_trees_and_focus_zones(block):
    assert not [p for p in opt.optimise(block, 900_000, avoid_zones=["NW", "N"]) if p["row"] < 20 and p["col"] < 40]
    assert sum(p["count"] for p in _trees_in(opt.optimise(block, 5_000_000, types=("tree",), max_trees=25))) <= 25
    in_se = lambda plan: np.mean([p["row"] >= 40 and p["col"] >= 40 for p in plan])        # noqa: E731
    focused = opt.optimise(block, 300_000, "hotspots", focus_zones=["SE"], types=("tree",))
    assert in_se(focused) > in_se(opt.optimise(block, 300_000, "hotspots", types=("tree",))) + 0.1


def test_auto_species_follow_the_climate_and_fixed_species_are_honoured(block):
    humid = Block.from_dict({**RAW, "climate": {"class": "humid"}})
    used = {p["species"] for p in _trees_in(opt.optimise(humid, 1_500_000, species="auto", years=20))}
    assert used and all("humid" in species_mod.get(s)["climates"] for s in used)
    assert {p["species"] for p in _trees_in(opt.optimise(block, 600_000, species="neem"))} == {"neem"}


def test_avoid_shaded_skips_cells_where_a_tree_would_add_under_half(block):
    ratio = opt.value_ratio(block)
    plan = _trees_in(opt.optimise(block, 2_000_000, avoid_shaded=True, types=("tree",)))
    assert plan and all(ratio[p["row"], p["col"]] >= opt.LOW_VALUE_BELOW for p in plan)


def test_shade_stops_are_added_from_what_is_left_and_go_on_roads(block):
    plan = opt.optimise(block, 3_000_000, include_shade_stops=True)
    stops = [p for p in plan if p["type"] == "shade_stop"]
    assert 1 <= len(stops) <= 3 and all(block.is_class(p["row"], p["col"], "road") for p in stops)
    assert simulate(block, plan)["metrics"]["total_cost_inr"] <= 3_000_000


def test_greedy_is_within_its_guarantee_of_the_true_optimum_on_small_grids():
    """Brute force on 4 × 4 grids: the proven floor is ½(1−1/e) ≈ 0.316; the measured ratio is what we may quote."""
    ratios = []
    for seed in range(6):
        rng = np.random.default_rng(seed)
        n = 4
        b = Block.from_dict({**RAW, "rows": n, "cols": n, "lst_c": (40 + 5 * rng.random((n, n))).tolist(),
                             "landcover": grid(3, n, n).astype(int).tolist(), "building_frac": grid(0, n, n).tolist(),
                             "roof_area_m2": grid(0, n, n).tolist(), "canopy_frac": (0.3 * rng.random((n, n))).tolist(),
                             "canopy_h": grid(9, n, n).tolist(), "carriageway_frac": grid(0, n, n).tolist(), "landmarks": []})
        w = opt.weights(b, "average")
        per_tree, cap, _, _ = opt.choose_species(b, 10, None)
        plan = opt.optimise(b, 4 * 3000, types=("tree",))
        got = np.zeros((n, n), int)
        for p in plan:
            got[p["row"], p["col"]] += p["count"]
        best = 0.0
        for combo in itertools.combinations_with_replacement(range(n * n), 4):
            t = np.zeros(n * n, int)
            for i in combo:
                t[i] += 1
            if (t > cap.ravel()).any():
                continue
            best = max(best, opt._plan_objective(b, w, per_tree, t.reshape(n, n)))
        ratios.append(opt._plan_objective(b, w, per_tree, got) / best)
    print(f"greedy / optimum over 6 random 4x4 grids: min {min(ratios):.4f}, mean {np.mean(ratios):.4f}")
    assert min(ratios) >= 0.5 * (1 - 1 / np.e)       # the proven bound
    assert min(ratios) >= 0.9                        # what we measure; a regression guard, not a theorem


def test_a_plan_over_a_hundred_cells_wide_is_computed_quickly():
    import time
    n = 100
    rng = np.random.default_rng(1)
    b = Block.from_dict({**RAW, "rows": n, "cols": n, "lst_c": (40 + 6 * rng.random((n, n))).tolist(),
                         "landcover": grid(3, n, n).astype(int).tolist(), "building_frac": (0.3 * rng.random((n, n))).tolist(),
                         "roof_area_m2": (30 * rng.random((n, n))).tolist(), "canopy_frac": grid(0, n, n).tolist(),
                         "canopy_h": grid(0, n, n).tolist(), "carriageway_frac": grid(0, n, n).tolist(), "landmarks": []})
    t = time.perf_counter()
    plan = opt.optimise(b, 5_000_000, species="auto")
    assert time.perf_counter() - t < 3.0 and plan
