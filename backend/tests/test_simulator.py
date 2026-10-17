"""The cooling model (app/domain/sim.py): physics, costs, validation, speed, and parity with the browser."""
import json
import time

import numpy as np
import pytest

from app.config import ROOT
from app.domain.sim import ASSUMPTIONS, Block, maturity, simulate


def test_nothing_placed_changes_nothing(cells):
    base = cells.metrics([])
    assert base["temp_reduction_c"] == 0 and base["total_cost_inr"] == 0 and base["cost_per_degree_inr"] is None


def test_more_trees_cool_more_with_diminishing_returns(cells):
    assert cells.metrics(cells.trees(200))["temp_reduction_c"] > cells.metrics(cells.trees(50))["temp_reduction_c"] > 0
    one = cells.trees(1)[0]
    peak = lambda n: cells.metrics([{**one, "count": n}])["peak_reduction_c"]
    assert peak(2) < 2 * peak(1)                              # two trees in one cell give less than twice one tree


def test_assumptions_stay_inside_their_sources(block, cells):
    assert abs(maturity(10) - 0.57) < 0.01 and abs(maturity(5) - 0.34) < 0.01 and maturity(30) < 1
    full = simulate(block, cells.trees(1000), years=30)
    assert -0.5 < full["metrics"]["aqi_change"] < 0          # trees barely move AQI (Nowak 2013: <= 0.24 % citywide)
    assert full["breakdown"]["aq_gain_pct"] <= 0.24
    assert all(a["status"] in {"cited", "derived", "estimate", "modelling choice", "under review"} for a in ASSUMPTIONS)
    assert all(a["sources"] for a in ASSUMPTIONS if a["status"] in {"cited", "derived", "estimate"})


def test_cool_roof_cools_its_surface_a_lot_and_the_street_a_little(block, cells):
    r, c = map(int, cells.roofs[0])
    out = simulate(block, [{"type": "cool_roof", "row": r, "col": c}])
    assert out["metrics"]["roof_surface_reduction_c"] > 5 > 0.5 > out["metrics"]["temp_reduction_c"]
    assert max(map(max, out["cooling_grid"])) > 5


def test_trees_grow_into_their_effect(cells):
    assert cells.metrics(cells.trees(100), years=1)["co2_captured_kg_per_year"] < cells.metrics(cells.trees(100))["co2_captured_kg_per_year"]


def test_costs_and_breakdown_add_up(block, cells):
    mix = cells.mix()
    r, c = map(int, cells.roofs[0])
    m = cells.metrics(mix)
    assert m["total_cost_inr"] == round(3 * 3000 + block.roof_area[r, c] * 250 + 1_000_000)
    bd = simulate(block, mix)["breakdown"]
    assert bd["trees"] == 3 and bd["stops"] == 1 and sum(bd["cost_parts"].values()) == m["total_cost_inr"]
    assert m["co2_captured_kg_per_year"] == round(bd["trees"] * bd["tree_co2_kg"] * bd["maturity"])


def test_bus_stop_cuts_exposure_without_cooling_air(cells):
    stop = cells.metrics([cells.mix()[-1]])
    assert stop["temp_reduction_c"] == 0 and stop["heat_exposure_reduction_pct"] >= 0


@pytest.mark.parametrize("bad", ["outside", "roof_on_road", "tree_in_building"])
def test_invalid_placements_are_rejected(block, cells, bad):
    placement = {
        "outside": {"type": "tree", "row": -1, "col": 0},
        "roof_on_road": {"type": "cool_roof", "row": cells.road[0], "col": cells.road[1]},
        "tree_in_building": {"type": "tree", "row": int(cells.roofs[0][0]), "col": int(cells.roofs[0][1])},
    }[bad]
    with pytest.raises(ValueError):
        simulate(block, [placement])


def test_a_thousand_trees_simulate_under_half_a_second(cells):
    t = time.perf_counter()
    cells.metrics(cells.trees(1000))
    assert time.perf_counter() - t < 0.5                     # PRD performance budget


def test_golden_fixtures_match():
    """The same cases the browser simulator must reproduce (shared/fixtures/golden.json)."""
    golden = json.loads((ROOT / "shared/fixtures/golden.json").read_text())
    raw = json.loads((ROOT / golden["block"]).read_text())
    for case in golden["cases"]:
        block = Block.from_dict({**raw, **{k: case[k] for k in golden["overridable"] if k in case}})
        got = simulate(block, case["placements"], case["years"])
        assert got["metrics"] == case["expected"]["metrics"], case["name"]
        assert round(float(np.array(got["cooling_grid"]).sum()), 2) == case["expected"]["cooling_sum"], case["name"]


def test_user_prices_change_costs_not_physics(block, cells):
    r, c = map(int, cells.open[0])
    pl = [{"type": "tree", "row": r, "col": c, "count": 2}]
    base, cheap = simulate(block, pl, 10), simulate(block, pl, 10, {"tree": 1500})
    assert base["metrics"]["total_cost_inr"] == 6000 and cheap["metrics"]["total_cost_inr"] == 3000
    assert cheap["breakdown"]["unit_cost"]["tree"] == 1500
    assert cheap["metrics"]["temp_reduction_c"] == base["metrics"]["temp_reduction_c"]
