"""The place brief: what the planning agent can SEE of an area, as plain numbers.

Zones, hotspots, existing canopy, where trees can physically go, who lives where, what is on each side of the box, and the
climate. Every figure is computed from the block's data, never estimated, so the agent can quote it and the numbers guardrail
can verify it.
"""
import numpy as np
from scipy.ndimage import distance_transform_edt, label

from app.domain import optimise, plantable, zones
from app.domain import species as species_mod
from app.domain.sim import Block

BIG_ROADS = {"motorway", "trunk", "primary", "secondary"}
HOTSPOT_PERCENTILE = 90
MAX_HOTSPOTS = 5
NEAR_CANOPY_CELLS = 2          # "beside existing canopy" means within this many cells (20 m)
CANOPY_CELL = 0.3              # a cell counts as canopy-covered from this share
WORLDCOVER = {"trees": 10, "water": 80, "built": 50}


def _round(x, n=1):
    return None if x is None else round(float(x), n)


def road_points(block: Block):
    """[(name, type, [(row, col), ...])] for the named roads, in cell units."""
    cell_m = block.meta["cell_m"]
    return [(r["name"], r["type"], [(z / cell_m, x / cell_m) for x, z in r["points"]]) for r in block.meta.get("roads", [])]


def _nearest_road(block: Block, r: float, c: float) -> tuple[str, float] | None:
    best = None
    for name, _, pts in road_points(block):
        d = min(((pr - r) ** 2 + (pc - c) ** 2) ** 0.5 for pr, pc in pts)
        if best is None or d < best[1]:
            best = (name, d * block.meta["cell_m"])
    return best


def _zone_roads(block: Block, z: str) -> list[str]:
    rows, cols = block.lst.shape
    r0, r1, c0, c1 = zones.bounds(rows, cols)[z]
    names = []
    for name, _, pts in road_points(block):
        if name not in names and any(r0 <= pr < r1 and c0 <= pc < c1 for pr, pc in pts):
            names.append(name)
    return names[:3]


def zone_stats(block: Block, z: str, capacity: np.ndarray) -> dict:
    rows, cols = block.lst.shape
    r0, r1, c0, c1 = zones.bounds(rows, cols)[z]
    sl = (slice(r0, r1), slice(c0, c1))
    out = block.outdoor[sl]
    lst = block.lst[sl]
    d = {"zone": z, "label": zones.LABELS[z],
         "mean_c": _round(lst.mean()), "outdoor_mean_c": _round(lst[out].mean()) if out.any() else None, "max_c": _round(lst.max()),
         "buildings_pct": _round(100 * block.building_frac[sl].mean(), 0), "canopy_pct": _round(100 * block.canopy_frac[sl].mean(), 0),
         "carriageway_pct": _round(100 * block.carriageway[sl].mean(), 0), "plantable_trees": int(capacity[sl].sum()),
         "landmarks": [lm["name"] for lm in block.meta.get("landmarks", []) if zones.zone_of(lm["row"], lm["col"], rows, cols) == z],
         "roads": _zone_roads(block, z)}
    if block.population is not None:
        d["residents"] = int(round(block.population[sl].sum()))
        d["vulnerable_residents"] = int(round(block.vulnerable[sl].sum()))
    return d


def hotspots(block: Block) -> list[dict]:
    """The hottest connected stretches of outdoor ground, with what is near each (road, landmark, distance to existing canopy)."""
    rows, cols = block.lst.shape
    out = block.outdoor
    thr = np.percentile(block.lst[out], HOTSPOT_PERCENTILE)
    lab, n = label(out & (block.lst >= thr))
    shade = block.canopy_frac >= CANOPY_CELL
    dist_to_canopy = distance_transform_edt(~shade) * block.meta["cell_m"] if shade.any() else None
    found = []
    for i in range(1, n + 1):
        cells = lab == i
        size = int(cells.sum())
        if size < 3:
            continue
        rr, cc = np.nonzero(cells)
        r, c = float(rr.mean()), float(cc.mean())
        road = _nearest_road(block, r, c)
        lms = [(abs(lm["row"] - r) + abs(lm["col"] - c), lm["name"]) for lm in block.meta.get("landmarks", [])]
        near_lm = min(lms) if lms else None
        found.append({"zone": zones.zone_of(int(r), int(c), rows, cols), "cells": size, "area_m2": int(size * block.meta["cell_m"] ** 2),
                      "mean_c": _round(block.lst[cells].mean()), "max_c": _round(block.lst[cells].max()),
                      "near_road": road[0] if road and road[1] <= 40 else None,
                      "near_landmark": near_lm[1] if near_lm and near_lm[0] * block.meta["cell_m"] <= 60 else None,
                      "distance_to_existing_canopy_m": _round(dist_to_canopy[int(r), int(c)], 0) if dist_to_canopy is not None else None,
                      "_rank": size * (float(block.lst[cells].mean()) - thr + 1)})
    found.sort(key=lambda h: -h["_rank"])
    for k, h in enumerate(found[:MAX_HOTSPOTS], 1):
        h["id"] = f"H{k}"
        h.pop("_rank")
    return found[:MAX_HOTSPOTS]


def surroundings(block: Block) -> dict | None:
    """What lies on each side of the box, from the 150 m ring: canopy, heat compared with the area, water, big roads."""
    ring = block.ring
    if not ring or "lst_c" not in ring:
        return None
    p, (rows, cols) = ring["pad"], block.lst.shape
    cell_m = block.meta["cell_m"]
    strips = {"N": (slice(0, p), slice(p, p + cols)), "S": (slice(p + rows, None), slice(p, p + cols)),
              "W": (slice(p, p + rows), slice(0, p)), "E": (slice(p, p + rows), slice(p + cols, None))}
    area_mean = float(block.lst.mean())
    out = {}
    for side, (rs, cs) in strips.items():
        lc = ring["landcover"][rs, cs]
        big = []
        for name, kind, pts in road_points(block):
            if kind in BIG_ROADS and name not in big and any(_in_strip(side, pr, pc, p, rows, cols) for pr, pc in pts):
                big.append(name)
        out[side] = {"canopy_pct": _round(100 * ring["canopy_frac"][rs, cs].mean(), 0), "mean_c": _round(ring["lst_c"][rs, cs].mean()),
                     "vs_area_c": _round(ring["lst_c"][rs, cs].mean() - area_mean), "water_pct": _round(100 * (lc == WORLDCOVER["water"]).mean(), 0),
                     "built_pct": _round(100 * (lc == WORLDCOVER["built"]).mean(), 0), "distance_m": p * cell_m, "big_roads": big[:3]}
    return out


def _in_strip(side: str, r: float, c: float, pad: int, rows: int, cols: int) -> bool:
    """Is the point (row, col in AREA cell units, may be negative or beyond) inside this side's ring strip?"""
    if side in ("N", "S"):
        return (-pad <= r < 0 if side == "N" else rows <= r < rows + pad) and 0 <= c < cols
    return (-pad <= c < 0 if side == "W" else cols <= c < cols + pad) and 0 <= r < rows


def place_brief(block: Block, budget: float, years: int) -> dict:
    rows, cols = block.lst.shape
    cell_m = block.meta["cell_m"]
    classes = block.meta["landcover_classes"]
    out = block.outdoor
    capacity = plantable.capacity_grid(block, species_mod.get(None))
    clim = block.meta.get("climate") or {}
    brief = {
        "place": {"name": block.meta["name"], "size_m": [rows * cell_m, cols * cell_m], "area_ha": round(rows * cols * cell_m**2 / 1e4, 1),
                  "climate_class": clim.get("class"), "hot_season_humidity_pct": clim.get("rh_pct"), "hot_season_max_temp_c": clim.get("tmax_hot_c"),
                  "wind_dir_deg": clim.get("wind_dir_deg"), "wind_ms": clim.get("wind_ms"),
                  "air_temp_now_c": (block.meta.get("conditions") or {}).get("air_temp_c"), "aqi_now": block.meta.get("baseline_aqi")},
        "data_quality": {"canopy_source": block.meta.get("canopy_source"),
                         "roads_source": block.meta.get("roads_source"), "population_source": block.meta.get("population_source"),
                         "heat_period": block.meta.get("lst_period"),
                         "canopy_disagrees_with_worldcover_pct": block.meta.get("canopy_disagrees_with_worldcover_pct")},
        "heat": {"mean_surface_c": _round(block.lst.mean()), "max_surface_c": _round(block.lst.max()),
                 "outdoor_mean_surface_c": _round(block.lst[out].mean()), "hot_threshold_c": _round(np.percentile(block.lst[out], 75))},
        "land": {"land_cover_pct": {k: _round(100 * (block.landcover == i).mean()) for i, k in enumerate(classes)},
                 "buildings_pct": _round(100 * block.building_frac.mean(), 0), "existing_canopy_pct": _round(100 * block.canopy_frac.mean(), 0),
                 "carriageway_pct": _round(100 * block.carriageway.mean(), 0), "plantable_trees": int(capacity.sum()),
                 "plantable_cells_pct": _round(100 * (capacity >= 1).mean(), 0), "roof_area_m2": int(block.roof_area.sum())},
        "zones": [zone_stats(block, z, capacity) for z in zones.ZONES],
        "hotspots": hotspots(block),
        "landmarks": [{"name": lm["name"], "kind": lm["kind"], "zone": zones.zone_of(lm["row"], lm["col"], rows, cols),
                       "local_surface_temp_c": _round(block.lst[max(lm["row"] - 5, 0):lm["row"] + 6, max(lm["col"] - 5, 0):lm["col"] + 6].mean())}
                      for lm in block.meta.get("landmarks", [])],
        "surroundings": surroundings(block),
        "budget_inr": budget, "years_after_planting": years,
    }
    if block.population is not None:
        brief["people"] = {"residents": int(round(block.population.sum())), "vulnerable_residents": int(round(block.vulnerable.sum())),
                           "vulnerable_pct": _round(100 * block.vulnerable.sum() / max(block.population.sum(), 1), 0),
                           "note": "WorldPop 2020, shared out by building floor area: reliable per zone, not per cell"}
    brief["species"] = [{"id": s["id"], "common": s["common"], "size": s["size_class"], "growth": s["growth"], "suits_this_climate": species_mod.suits(s, clim.get("class"))}
                        for s in species_mod.BY_ID.values() if s["id"] != species_mod.DEFAULT]
    brief["rules"] = {"humid_airflow_rule": block.humid, "min_value_ratio_for_a_tree": optimise.LOW_VALUE_BELOW}
    return brief
