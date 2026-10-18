"""check_plan: the agent's critique of its own plan, computed (not asked of the model).

The headline test is `low_value_tree_ratio`: the share of new trees that add less than half of what the same tree would on bare
ground because the spot is already shaded. Planting NEXT TO existing canopy is not waste (extending shade edges towards hot
streets is the point); planting INSIDE shade is. `trees_beside_existing_canopy_ratio` is reported for information.
"""
import numpy as np
from scipy.ndimage import binary_dilation

from app.agents import context
from app.domain import optimise, zones
from app.domain.sim import Block, simulate

LOW_VALUE_LIMIT = 0.10        # a plan with more than this share of low-value trees is sent back
HOT_ZONE_ABOVE_C = 1.0        # a zone this much hotter than the outdoor average counts as a hot zone
VULNERABLE_ZONE_SHARE = 0.15  # a zone holding at least this share of vulnerable residents deserves attention
MONOCULTURE_SHARE = optimise.MAX_SPECIES_SHARE   # one species above the planner's own mix target is flagged
LOW_BUDGET_USE_PCT = 60       # below this share of the budget spent, the check explains why more could not be placed


def check_plan(block: Block, placements: list[dict], years: int, unit_cost: dict | None, budget: float) -> dict:
    rows, cols = block.lst.shape
    sim = simulate(block, placements, years, unit_cost)
    m = sim["metrics"]
    trees = [p for p in placements if p["type"] == "tree"]
    n_trees = sum(p.get("count", 1) for p in trees)
    ratio = optimise.value_ratio(block)
    near = binary_dilation(block.canopy_frac >= context.CANOPY_CELL, iterations=context.NEAR_CANOPY_CELLS) if (block.canopy_frac >= context.CANOPY_CELL).any() else np.zeros((rows, cols), bool)
    low = sum(p.get("count", 1) for p in trees if ratio[p["row"], p["col"]] < optimise.LOW_VALUE_BELOW)
    beside = sum(p.get("count", 1) for p in trees if near[p["row"], p["col"]])
    per_zone = {z: 0 for z in zones.ZONES}          # anything planned there (trees, roofs, shelters): "untouched" means none of them
    trees_zone = {z: 0 for z in zones.ZONES}
    for p in placements:
        z = zones.zone_of(p["row"], p["col"], rows, cols)
        per_zone[z] += p.get("count", 1)
        if p["type"] == "tree":
            trees_zone[z] += p.get("count", 1)
    roofs = [(p["row"], p["col"]) for p in placements if p["type"] == "cool_roof"]
    stops = [(p["row"], p["col"]) for p in placements if p["type"] == "shade_stop"]
    under = lambda a: int(round(sum(float(a[r, c]) for r, c in set(roofs)))) if a is not None else None  # noqa: E731
    bus_stops = [lm for lm in block.meta.get("landmarks", []) if lm["kind"] == "bus stop"]
    sheltered = [lm["name"] for lm in bus_stops
                 if any(abs(r - lm["row"]) <= optimise.BUS_STOP_REACH and abs(c - lm["col"]) <= optimise.BUS_STOP_REACH for r, c in stops)]
    outdoor_mean = float(block.lst[block.outdoor].mean())
    stats = {z: context.zone_stats(block, z, np.zeros((rows, cols), int)) for z in zones.ZONES}
    hot_untouched = [z for z in zones.ZONES if stats[z]["outdoor_mean_c"] is not None and stats[z]["outdoor_mean_c"] >= outdoor_mean + HOT_ZONE_ABOVE_C and per_zone[z] == 0]
    vuln_untouched = []
    if block.vulnerable is not None and block.vulnerable.sum() > 0:
        total = block.vulnerable.sum()
        vuln_untouched = [z for z in zones.ZONES if stats[z].get("vulnerable_residents", 0) / total >= VULNERABLE_ZONE_SHARE and per_zone[z] == 0]
    low_ratio = round(low / n_trees, 3) if n_trees else 0.0
    report = {
        "budget_used_pct": round(100 * m["total_cost_inr"] / budget, 1) if budget else None,
        "trees": n_trees, "trees_per_zone": {z: n for z, n in trees_zone.items() if n}, "trees_by_species": sim["breakdown"]["trees_by_species"],
        "dominant_species_share": round(max(sim["breakdown"]["trees_by_species"].values()) / n_trees, 3) if n_trees else 0.0,
        "low_value_tree_ratio": low_ratio, "trees_beside_existing_canopy_ratio": round(beside / n_trees, 3) if n_trees else 0.0,
        "hot_zones_untouched": hot_untouched, "vulnerable_zones_untouched": vuln_untouched,
        "surface_cooling_c": m["temp_reduction_c"], "air_cooling_c": m["air_reduction_c"], "equity_cooling_c": m["equity_cooling_c"],
        "heat_exposure_pct": m["heat_exposure_pct"], "cost_per_degree_inr": m["cost_per_degree_inr"],
        "cool_roofs": len(set(roofs)), "cool_roof_m2": round(sum(float(block.roof_area[r, c]) for r, c in set(roofs))),
        "residents_under_cool_roofs": under(block.population), "vulnerable_under_cool_roofs": under(block.vulnerable),
        "shade_stops": len(stops), "bus_stops_mapped": len(bus_stops), "bus_stops_sheltered": sheltered,
    }
    report["advice"] = advice(report)
    return report


def advice(r: dict) -> list[str]:
    """What to fix, in words the model can act on (and a person can read)."""
    out = []
    if r["low_value_tree_ratio"] > LOW_VALUE_LIMIT:
        out.append(f"{round(100 * r['low_value_tree_ratio'])}% of the trees sit where existing shade already does most of the work "
                   "(each adds under half of its bare-ground value): run the scenario again with avoid_shaded=true.")
    if r["hot_zones_untouched"]:
        out.append(f"Hot zones with nothing planned: {', '.join(r['hot_zones_untouched'])}. Consider focus_zones for them.")
    if r["vulnerable_zones_untouched"]:
        out.append(f"Zones with many vulnerable residents and nothing planned: {', '.join(r['vulnerable_zones_untouched'])}.")
    if r["trees"] >= 20 and r["dominant_species_share"] > MONOCULTURE_SHARE:
        out.append(f"{round(100 * r['dominant_species_share'])}% of the trees are one species: mention that mixing species would protect against pests and disease.")
    if r["budget_used_pct"] is not None and r["budget_used_pct"] < LOW_BUDGET_USE_PCT:
        out.append(f"Only {r['budget_used_pct']}% of the budget is used: little more can be placed under the rules (capacity, shade, airflow).")
    return out


# The thresholds above, for the Method page (GET /assumptions).
ASSUMPTION = {
    "item": "How the AI's plans are checked",
    "value": f"A tree is low value below {optimise.LOW_VALUE_BELOW:.0%} of its bare-ground effect; a plan with more than "
             f"{LOW_VALUE_LIMIT:.0%} low-value trees cannot be recommended",
    "status": "modelling choice",
    "why": f"Code, not the model, checks every plan Gemini proposes. It also flags zones {HOT_ZONE_ABOVE_C:g} °C hotter than the outdoor "
           f"average with nothing planned, zones holding {VULNERABLE_ZONE_SHARE:.0%} or more of the vulnerable residents with nothing "
           f"planned, any species above {MONOCULTURE_SHARE:.0%} of the trees, and a budget less than {LOW_BUDGET_USE_PCT}% used. "
           "Only the low-value rule refuses a plan; the rest is advice Gemini must address.",
    "sources": [],
}
