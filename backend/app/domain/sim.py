"""The cooling model: a fast grid surrogate, explainable, labelled 'estimated' in the UI. Its sources are in app/domain/assumptions.py."""
import json
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

import numpy as np
from scipy.ndimage import convolve

from app.config import MODEL
from app.domain import canopy, plantable
from app.domain import species as species_mod

# Every coefficient below has a source, a stated derivation, or is labelled a modelling choice: see app/domain/assumptions.py (GET /assumptions).
# The numbers live in shared/model.json so the browser simulator (frontend/src/model) uses exactly the same ones.
# Meaning of each: types.*.cost ₹ per unit · cool_c °C over an area with one mature item per cell (spread by a kernel that sums to 1) · sigma decay (cells);
# cool_roof.cost is per m² and cool_c is spill-over onto the street; shade_stop is exposure only, not ambient.
TYPES = MODEL["types"]
COOLING_CAP_C = MODEL["cooling_cap_c"]  # diminishing returns ceiling per cell (street level)
# Published estimates of surface cooling differ ~8×, so street cooling is reported as a range: tree cool_c is the high end
# (Schwaab et al. 2021) and drives the optimiser and map; cool_c_low (Ruiz-Valero et al. 2026) gives the low end.
TREE_LOW_SHARE = TYPES["tree"]["cool_c_low"] / TYPES["tree"]["cool_c"]
# Roof surface cooling from the surface energy balance: ΔT ≈ Δalbedo × sunlight ÷ heat-transfer coefficient
ROOF_ALBEDO_GAIN, SUN_W_M2, HEAT_TRANSFER_W_M2K = (MODEL["roof"][k] for k in ("albedo_gain", "sun_w_m2", "heat_transfer_w_m2k"))
ROOF_SURFACE_C = round(ROOF_ALBEDO_GAIN * SUN_W_M2 / HEAT_TRANSFER_W_M2K, 1)  # ≈ 9.3 °C on the roof itself
TREE_CO2_KG_YR = MODEL["tree"]["co2_kg_yr"]            # 0.28 kg C/m² of cover/yr (Nowak et al. 2013) × 50 m² × 44/12
GROWTH_TAU_YEARS = MODEL["tree"]["growth_tau_years"]  # crown growth is fast early and slows later: effect = 1 − e^(−years/τ)
CANOPY_M2_PER_TREE = MODEL["tree"]["canopy_m2"]       # mature street-tree crown ~8 m across
NOWAK_AQ_GAIN = MODEL["air_quality"]["nowak_gain"]    # best-case citywide PM2.5 improvement from trees (Atlanta, Nowak et al. 2013)
NOWAK_CANOPY = MODEL["air_quality"]["nowak_canopy"]   # ...at roughly this much canopy cover
RULES = MODEL["placement_rules"]
LANDMARK_RADIUS = MODEL["landmark_radius_cells"]      # cells (~50 m) averaged for "cooling near the school" etc.
HOT_PERCENTILE = MODEL["hot_percentile"]              # outdoor cells above this baseline percentile count as "exposed"
OUTDOOR_BELOW = MODEL["outdoor_building_frac_below"]
AIR = MODEL["air"]
LEGACY_ROAD_CARRIAGEWAY = 0.45   # areas without OSM road data: a land-cover road cell is ~half carriageway, half footpath (an estimate)


def maturity(years: int) -> float:
    """Share of a tree's full effect after `years`: 8% in year 1, 34% by 5, 57% by 10, 81% by 20."""
    return float(1 - np.exp(-max(years, 1) / GROWTH_TAU_YEARS))


def _opt(d: dict, key: str, default):
    v = d.pop(key, None)
    return np.array(v, dtype=float) if v is not None else default


@dataclass
class Block:
    meta: dict
    lst: np.ndarray
    landcover: np.ndarray
    building_frac: np.ndarray
    roof_area: np.ndarray
    canopy_frac: np.ndarray            # share of each cell under tree canopy today (0..1)
    canopy_h: np.ndarray               # mean canopy height there, metres
    carriageway: np.ndarray            # share of each cell that is road surface (0..1)
    exposure: np.ndarray | None = None     # people-weighted heat exposure (vulnerable residents nearby), None without population data
    population: np.ndarray | None = None
    vulnerable: np.ndarray | None = None   # residents aged 65+ or under 5
    ring: dict | None = None               # {"pad": cells, "canopy_frac", "canopy_h"} over the area plus `pad` cells all round

    @classmethod
    def load(cls, path: Path) -> "Block":
        return cls.from_json(path.read_text())

    @classmethod
    def from_json(cls, text: str) -> "Block":
        return cls.from_dict(json.loads(text))

    @classmethod
    def from_dict(cls, d: dict) -> "Block":
        d = dict(d)   # popping fields below must not damage the caller's copy
        arrays = {k: np.array(d.pop(k)) for k in ("lst_c", "landcover", "building_frac", "roof_area_m2")}
        shape = arrays["lst_c"].shape
        classes = d["landcover_classes"]
        road = arrays["landcover"] == classes.index("road") if "road" in classes else np.zeros(shape, bool)
        ring = d.pop("ring", None)
        if ring:
            ring = {"pad": int(ring["pad"]), **{k: np.array(v, dtype=float) for k, v in ring.items() if k != "pad"}}
        return cls(d, arrays["lst_c"], arrays["landcover"], arrays["building_frac"], arrays["roof_area_m2"],
                   canopy_frac=_opt(d, "canopy_frac", np.zeros(shape)), canopy_h=_opt(d, "canopy_h", np.zeros(shape)),
                   carriageway=_opt(d, "carriageway_frac", np.where(road, LEGACY_ROAD_CARRIAGEWAY, 0.0)),
                   exposure=_opt(d, "exposure", None), population=_opt(d, "population", None), vulnerable=_opt(d, "vulnerable", None),
                   ring=ring or None)

    @property
    def outdoor(self):
        return self.building_frac < OUTDOOR_BELOW

    @property
    def humid(self) -> bool:
        return self.meta.get("climate", {}).get("class") == "humid"

    def is_class(self, r, c, name):
        return self.meta["landcover_classes"][self.landcover[r, c]] == name

    def landcover_name(self, r, c):
        return self.meta["landcover_classes"][self.landcover[r, c]]

    @cached_property
    def existing_equiv(self) -> np.ndarray:
        """Existing canopy as generic mature trees per cell (see canopy.tree_equivalents)."""
        return canopy.tree_equivalents(self.canopy_frac, self.canopy_h, self.meta["cell_m"])

    @cached_property
    def existing(self) -> tuple[np.ndarray, np.ndarray]:
        """(surface, air) raw cooling exposure from trees that are already there, including those in the 150 m ring."""
        ring = self.ring
        ring_equiv = canopy.tree_equivalents(ring["canopy_frac"], ring["canopy_h"], self.meta["cell_m"]) if ring else None
        return canopy.existing_raw(self.existing_equiv, ring_equiv, ring["pad"] if ring else 0,
                                   {"surface": KERNELS["tree"], "air": AIR_KERNEL}, TYPES["tree"]["cool_c"])


KERNELS = {t: canopy.kernel(s["sigma"]) for t, s in TYPES.items() if s["sigma"]}
AIR_KERNEL = canopy.kernel(AIR["sigma"])


def _validate(block: Block, placements):
    seen = set()
    cell_trees: dict[tuple, int] = {}   # trees already placed per cell, so several placements share one cell's capacity
    cell_sp: dict[tuple, dict] = {}     # the most space-hungry species placed there decides how many fit
    planned = np.zeros(block.lst.shape) if block.humid else None
    for i, p in enumerate(placements):
        t, r, c = p["type"], p["row"], p["col"]
        where = f"placement {i} ({t} at {r},{c})"
        if t not in TYPES:
            raise ValueError(f"{where}: unknown type")
        if not (0 <= r < block.lst.shape[0] and 0 <= c < block.lst.shape[1]):
            raise ValueError(f"{where}: outside block")
        rule = RULES[t]
        if t == "tree":
            n = p.get("count", 1)
            if not 1 <= n <= rule["max_count_per_cell"]:
                raise ValueError(f"{where}: count must be 1..{rule['max_count_per_cell']}")
            if p.get("species") and p["species"] not in species_mod.BY_ID:
                raise ValueError(f"{where}: unknown species")
            sp = species_mod.get(p.get("species"))
            prev = cell_sp.get((r, c))
            worst = sp if prev is None or species_mod.spacing_m(sp) >= species_mod.spacing_m(prev) else prev
            cell_sp[(r, c)] = worst
            cell_trees[(r, c)] = cell_trees.get((r, c), 0) + n
            if why := plantable.block_reason(block, worst, r, c, cell_trees[(r, c)]):
                raise ValueError(f"{where}: {why}")
            if planned is not None:
                planned[r, c] += n * species_mod.crown_m2(sp)
        else:
            if rule.get("unique_per_cell"):
                if (t, r, c) in seen:
                    raise ValueError(f"{where}: already placed in this cell")
                seen.add((t, r, c))
            if rule.get("requires_roof") and block.roof_area[r, c] <= 0:
                raise ValueError(f"{where}: no roof in this cell")
            if "allowed_landcover" in rule and block.landcover_name(r, c) not in rule["allowed_landcover"]:
                raise ValueError(f"{where}: bus stops go on roads")
    if planned is not None and plantable.humid_violation(block, planned):
        raise ValueError("Too many trees close together for a humid climate: leave room for air to move")


def prices(unit_cost: dict | None = None) -> dict:
    """₹ per unit for each type: the sourced defaults, overridden by whatever the user set."""
    return {t: float((unit_cost or {}).get(t) or TYPES[t]["cost"]) for t in TYPES}


def _equity(block: Block, street: np.ndarray, out: np.ndarray) -> float | None:
    """Mean cooling where exposure is highest (top quartile of outdoor cells), or None without population data."""
    if block.exposure is None or not block.exposure[out].any():
        return None
    top = out & (block.exposure >= np.percentile(block.exposure[out], 75))
    return round(float(street[top].mean()), 3) if top.any() else None


@dataclass
class Evaluation:
    """Everything one plan does, as grids (street / air / surface cooling) and totals. simulate() formats it for the API."""
    street: np.ndarray
    air: np.ndarray
    surface: np.ndarray
    shaded: np.ndarray
    trees: float
    roof_m2: float
    stops: float
    crown_m2_grown: float
    co2_kg: float
    by_species: dict
    cost_parts: dict
    price: dict
    grown: float
    street_low: np.ndarray   # street cooling at the low end of the published range


def evaluate(block: Block, placements: list[dict], years: int = 10, unit_cost: dict | None = None) -> Evaluation:
    _validate(block, placements)
    price = prices(unit_cost)
    grown = maturity(years)
    shape = block.lst.shape

    tree_units = np.zeros(shape)   # effect-weighted trees: count × how grown × crown size relative to the generic tree
    roof_dep = np.zeros(shape)
    shaded = np.zeros(shape, bool)
    trees = roof_m2 = stops = 0.0
    crown_m2_grown = co2_kg = 0.0
    by_species: dict[str, int] = {}
    for p in placements:
        t, r, c = p["type"], p["row"], p["col"]
        if t == "tree":
            n = p.get("count", 1)
            sp = species_mod.get(p.get("species"))
            mat, ratio = species_mod.maturity(sp, years), species_mod.crown_ratio(sp)
            trees += n
            tree_units[r, c] += n * mat * ratio
            crown_m2_grown += n * mat * species_mod.crown_m2(sp)
            co2_kg += n * TREE_CO2_KG_YR * mat * ratio
            by_species[sp["id"]] = by_species.get(sp["id"], 0) + n
        elif t == "cool_roof":
            roof_dep[r, c] += block.building_frac[r, c]
            roof_m2 += block.roof_area[r, c]
        else:
            shaded[r, c] = True
            stops += 1
    cost_parts = {"tree": trees * price["tree"], "cool_roof": roof_m2 * price["cool_roof"], "shade_stop": stops * price["shade_stop"]}

    # What the new items add on top of the shade that is already there (inside the box and in the ring around it).
    existing_surface, existing_air = block.existing
    tree_surface = TYPES["tree"]["cool_c"] * convolve(tree_units, KERNELS["tree"], mode="constant")
    roof_spill = TYPES["cool_roof"]["cool_c"] * convolve(roof_dep, KERNELS["cool_roof"], mode="constant")
    new_air = AIR["per_tree_c"] * convolve(tree_units, AIR_KERNEL, mode="constant")
    street = canopy.marginal(existing_surface, tree_surface + roof_spill, COOLING_CAP_C)   # what people feel: shade + roof spill-over
    street_low = canopy.marginal(existing_surface * TREE_LOW_SHARE, tree_surface * TREE_LOW_SHARE + roof_spill, COOLING_CAP_C)
    air = canopy.marginal(existing_air, new_air, AIR["cap_c"])                # air temperature: a smaller, wider effect
    surface = street + ROOF_SURFACE_C * roof_dep                              # what the satellite sees: + the roofs themselves
    return Evaluation(street, air, surface, shaded, trees, roof_m2, stops, crown_m2_grown, co2_kg, by_species, cost_parts, price, grown, street_low)


def simulate(block: Block, placements: list[dict], years: int = 10, unit_cost: dict | None = None) -> dict:
    ev = evaluate(block, placements, years, unit_cost)
    street, air, surface, shaded = ev.street, ev.air, ev.surface, ev.shaded
    trees, roof_m2, stops, grown = ev.trees, ev.roof_m2, ev.stops, ev.grown
    crown_m2_grown, co2_kg, by_species, cost_parts, price = ev.crown_m2_grown, ev.co2_kg, ev.by_species, ev.cost_parts, ev.price
    cost = sum(cost_parts.values())

    block_m2 = block.lst.size * block.meta["cell_m"] ** 2
    added_canopy = crown_m2_grown / block_m2   # share of the block the grown crowns cover
    aqi_gain = NOWAK_AQ_GAIN * added_canopy / NOWAK_CANOPY          # fraction cleaner air
    after = block.lst - street

    out = block.outdoor
    hot = np.percentile(block.lst[out], HOT_PERCENTILE)
    exposed_before = (out & (block.lst >= hot)).sum()
    exposed_after = (out & (after >= hot) & ~shaded).sum()

    temp_drop = float(street[out].mean())  # headline: average over streets, parks and open ground
    low = ev.street_low
    low_drop = float(low[out].mean())
    exposed_after_low = (out & (block.lst - low >= hot) & ~shaded).sum()

    def near(lm):  # street cooling within LANDMARK_RADIUS of a landmark, outdoor cells only
        win = (slice(max(lm["row"] - LANDMARK_RADIUS, 0), lm["row"] + LANDMARK_RADIUS + 1),
               slice(max(lm["col"] - LANDMARK_RADIUS, 0), lm["col"] + LANDMARK_RADIUS + 1))
        o = out[win]
        return round(float(street[win][o].mean()), 2) if o.any() else 0.0
    return {
        "metrics": {
            "temp_reduction_c": round(temp_drop, 3),
            "air_reduction_c": round(float(air[out].mean()), 3),
            "equity_cooling_c": _equity(block, street, out),
            "peak_reduction_c": round(float(street[out].max()), 2),
            "surface_reduction_c": round(float(surface.mean()), 3),
            "roof_surface_reduction_c": round(float(surface.max()), 2) if roof_m2 else 0.0,
            "heat_exposure_pct": round(float(100 * exposed_after / out.sum()), 1),
            "heat_exposure_reduction_pct": round(float(100 * (exposed_before - exposed_after) / exposed_before), 1),
            "co2_captured_kg_per_year": round(co2_kg),
            "aqi_change": round(-aqi_gain * (block.meta.get("baseline_aqi") or 0), 3),   # 0 without a reading
            "total_cost_inr": round(cost),
            "cost_per_degree_inr": round(cost / temp_drop) if temp_drop > 1e-6 else None,
            "landmark_cooling_c": {lm["name"]: near(lm) for lm in block.meta.get("landmarks", [])},
            # the same headline figures at the low end of the published range (see TREE_LOW_SHARE)
            "low_estimate": {
                "temp_reduction_c": round(low_drop, 3),
                "peak_reduction_c": round(float(low[out].max()), 2),
                "heat_exposure_pct": round(float(100 * exposed_after_low / out.sum()), 1),
                "heat_exposure_reduction_pct": round(float(100 * (exposed_before - exposed_after_low) / exposed_before), 1),
                "cost_per_degree_inr": round(cost / low_drop) if low_drop > 1e-6 else None,
            },
        },
        "cooling_grid": np.round(surface, 2).tolist(),  # the map shows surfaces, so painted roofs visibly cool
        # the inputs behind each metric, so the app can show "how this was calculated" with real numbers
        "breakdown": {
            "trees": int(trees), "roof_m2": round(float(roof_m2)), "stops": int(stops), "maturity": round(grown, 4),
            "trees_by_species": by_species,
            "canopy_m2_per_tree": CANOPY_M2_PER_TREE, "added_canopy_pct": round(added_canopy * 100, 2),
            "aq_gain_pct": round(aqi_gain * 100, 4), "nowak_gain_pct": NOWAK_AQ_GAIN * 100, "nowak_canopy_pct": NOWAK_CANOPY * 100,
            "baseline_aqi": block.meta.get("baseline_aqi"), "growth_tau": GROWTH_TAU_YEARS,
            "cells": int(street.size), "cell_m": block.meta["cell_m"], "roof_surface_c": ROOF_SURFACE_C,
            "tree_cool_c": TYPES["tree"]["cool_c"], "tree_cool_c_low": TYPES["tree"]["cool_c_low"], "tree_reach_m": round(TYPES["tree"]["sigma"] * 3 * block.meta["cell_m"]),
            "roof_cool_c": TYPES["cool_roof"]["cool_c"], "cap_c": COOLING_CAP_C, "air_cap_c": AIR["cap_c"],
            "tree_co2_kg": TREE_CO2_KG_YR,
            "existing_tree_equivalents": round(float(block.existing_equiv.sum())),
            "climate_class": block.meta.get("climate", {}).get("class"),
            "hot_threshold_c": round(float(hot), 1), "hot_percentile": HOT_PERCENTILE,
            "outdoor_cells": int(out.sum()), "exposed_before": int(exposed_before), "exposed_after": int(exposed_after),
            "unit_cost": {t: round(v) for t, v in price.items()},
            "cost_parts": {t: round(v) for t, v in cost_parts.items()},
        },
        "estimated": True,
    }
