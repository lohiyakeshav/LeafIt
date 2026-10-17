"""Grid surrogate model (PRD §8). Fast, explainable, labelled 'estimated' in the UI."""
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.ndimage import convolve

from app.config import MODEL

# Every coefficient below has a source or a stated derivation; see docs/assumptions.md and GET /assumptions.
# The numbers live in shared/model.json so the browser simulator (frontend/src/model) uses exactly the same ones.
# Meaning of each: types.*.cost ₹ per unit · cool_c °C at own cell (mature) · sigma decay (cells);
# cool_roof.cost is per m² and cool_c is spill-over onto the street; shade_stop is exposure only, not ambient.
TYPES = MODEL["types"]
COOLING_CAP_C = MODEL["cooling_cap_c"]  # diminishing returns ceiling per cell (street level)
# Roof surface cooling from the surface energy balance: ΔT ≈ Δalbedo × sunlight ÷ heat-transfer coefficient
ROOF_ALBEDO_GAIN, SUN_W_M2, HEAT_TRANSFER_W_M2K = (MODEL["roof"][k] for k in ("albedo_gain", "sun_w_m2", "heat_transfer_w_m2k"))
ROOF_SURFACE_C = round(ROOF_ALBEDO_GAIN * SUN_W_M2 / HEAT_TRANSFER_W_M2K, 1)  # ≈ 9.3 °C on the roof itself
TREE_CO2_KG_YR = MODEL["tree"]["co2_kg_yr"]            # mature urban street tree; literature range ~4–340 kg
GROWTH_TAU_YEARS = MODEL["tree"]["growth_tau_years"]  # crown growth is fast early and slows later: effect = 1 − e^(−years/τ)
CANOPY_M2_PER_TREE = MODEL["tree"]["canopy_m2"]       # mature street-tree crown ~8 m across
NOWAK_AQ_GAIN = MODEL["air_quality"]["nowak_gain"]    # best-case citywide PM2.5 improvement from trees (Atlanta, Nowak et al. 2013)
NOWAK_CANOPY = MODEL["air_quality"]["nowak_canopy"]   # ...at roughly this much canopy cover
RULES = MODEL["placement_rules"]
MAX_TREES_PER_CELL = RULES["tree"]["max_count_per_cell"]
LANDMARK_RADIUS = MODEL["landmark_radius_cells"]      # cells (~50 m) averaged for "cooling near the school" etc.
HOT_PERCENTILE = MODEL["hot_percentile"]              # outdoor cells above this baseline percentile count as "exposed"
OUTDOOR_BELOW = MODEL["outdoor_building_frac_below"]


def maturity(years: int) -> float:
    """Share of a tree's full effect after `years`: 8% in year 1, 34% by 5, 57% by 10, 81% by 20."""
    return float(1 - np.exp(-max(years, 1) / GROWTH_TAU_YEARS))


def _src(title, url):
    return {"title": title, "url": url}


# Served by GET /assumptions for the "How we calculate this" screen.
# status: "cited" (a source gives this value) · "derived" (computed from cited figures) ·
#         "estimate" (best guess inside a cited range) · "modelling choice" · "under review"
ASSUMPTIONS = [
    {"item": "Tree cooling",
     "value": f"Up to {TYPES['tree']['cool_c']} °C off its 10 m cell's surface temperature when fully grown",
     "status": "derived",
     "why": "A Landsat study controlling for other factors found ~0.27 °C cooler surfaces when canopy covers half of a 30 m unit. "
            "One mature crown (~50 m²) covers about half of a 10 m cell, so ~0.3 °C per tree. Shade on pavement itself can be "
            "20 °C+ cooler, but a satellite pixel mixes shade, sun and walls.",
     "sources": [_src("Local cooling from urban tree canopy, Plants People Planet (2025)", "https://eprints.whiterose.ac.uk/id/eprint/234726"),
                 _src("Woodland Trust/Cardiff thermal imaging: 20 °C shade vs sun", "https://bosf.org.uk/?p=3568")]},
    {"item": "How far cooling reaches",
     "value": f"Fades with distance, mostly gone by ~{TYPES['tree']['sigma'] * 10 * 3:.0f} m",
     "status": "cited",
     "why": "Satellite studies find tree cooling significant up to 30–90 m from green space; small parks show effects to ~18 m.",
     "sources": [_src("Gallay et al. (2023), cooling distance of urban green", "https://ideas.repec.org/a/gam/jsusta/v15y2023i4p3705-d1071642.html"),
                 _src("Park shape and cooling distance, Landscape Ecology (2024)", "https://link.springer.com/article/10.1007/s10980-024-01818-y")]},
    {"item": "Tree growth",
     "value": f"Effect grows as 1 − e^(−years/{GROWTH_TAU_YEARS}): 34% by year 5, 57% by year 10, 81% by year 20",
     "status": "derived",
     "why": "Street-tree crowns grow fastest in the first 15 years and slow after; crowns keep widening for decades "
            "(linden crown growth flattens around 45 years).",
     "sources": [_src("Peper et al., street-tree growth in Modesto (USDA Forest Service)", "https://research.fs.usda.gov/treesearch/46301"),
                 _src("Tilia physical dimensions over time, Arboriculture & Urban Forestry", "https://auf.isa-arbor.com/content/28/5/209")]},
    {"item": "Tree CO₂",
     "value": f"{TREE_CO2_KG_YR} kg CO₂ per fully grown tree per year",
     "status": "estimate",
     "why": "Measured street trees capture 3.5–13 kg/yr (Helsinki); larger trees 16–340 kg/yr by trunk size (Chicago); "
            "a citywide average is ~40 kg/yr (Sacramento). 21.8 kg is a conservative middle for Delhi street trees.",
     "sources": [_src("McPherson (1998), carbon sequestration by urban trees, USDA", "https://www.fs.usda.gov/psw/publications/mcpherson/psw_1998_mcpherson003.pdf")]},
    {"item": "Air quality",
     "value": f"Best case {NOWAK_AQ_GAIN * 100:.2f}% cleaner air at {NOWAK_CANOPY * 100:.0f}% canopy, scaled to the canopy this plan adds "
              f"({CANOPY_M2_PER_TREE} m² per grown tree)",
     "status": "derived",
     "why": "Trees remove PM2.5 but barely move a city's AQI: modelled improvement was 0.05–0.24% across ten US cities. "
            "We use the best case (Atlanta) and scale it to this block, so the AQI change is honest and small.",
     "sources": [_src("Nowak et al. (2013), PM2.5 removal by trees in ten US cities", "https://pubmed.ncbi.nlm.nih.gov/23624337/")]},
    {"item": "Tree cost",
     "value": f"₹{TYPES['tree']['cost']:,} per tree: sapling, metal guard, planting and 3 years of care",
     "status": "estimate",
     "why": "An itemised Indian costing gives ₹200 planting + ₹1,000 metal guard + ₹400 for 3 years' care (1990s prices); "
            "MCD paid ~₹430 per small sapling in 2010. ₹3,000 is a low-end current figure: get vendor quotes through LeafIt.",
     "sources": [_src("IISc energy-plantation costing (planting, guard, 3-yr care)", "https://wgbis.ces.iisc.ac.in/energy/water/paper/ETR90/sec7.html"),
                 _src("Lok Sabha answer: MCD Commonwealth Games planting cost", "https://eparlib.nic.in/bitstream/123456789/594902/1/98233.pdf")]},
    {"item": "Cool roof: roof surface",
     "value": f"{ROOF_SURFACE_C} °C cooler roof surface × roof share of the cell (shown on the map)",
     "status": "derived",
     "why": f"Surface energy balance: albedo gain {ROOF_ALBEDO_GAIN} (aged white coating vs concrete) × {SUN_W_M2} W/m² sun "
            f"÷ {HEAT_TRANSFER_W_M2K} W/m²K ≈ {ROOF_SURFACE_C} °C. Measurements agree: white roofs run 20 °C+ cooler than dark ones at peak (LBNL).",
     "sources": [_src("US DOE: cool roofing technologies (LBNL)", "https://www.energy.gov/sites/prod/files/2015/07/f25/Cool_Roofing_Technologies.pdf"),
                 _src("LBNL roof surface vs air temperature (OSTI)", "https://www.osti.gov/biblio/296884")]},
    {"item": "Cool roof: at street level",
     "value": f"{TYPES['cool_roof']['cool_c']} °C × roof share, spilling ~{TYPES['cool_roof']['sigma'] * 10 * 3:.0f} m onto nearby streets; "
              f"₹{TYPES['cool_roof']['cost']}/m²",
     "status": "estimate",
     "why": "A roof cools mostly itself and the rooms below (1.3–2 °C indoors in Kerala and Hyderabad pilots); its effect on the street "
            "is small (city-wide retrofits are modelled at up to 0.5 °C). Cost sits in the Indian range: lime-wash ₹5/m², membranes ~₹140/m².",
     "sources": [_src("NRDC: cool roof programs in Ahmedabad and Hyderabad", "https://www.nrdc.org/experts/anjali-jaiswal/keeping-it-cool-models-city-cool-roof-programs"),
                 _src("Rooftop albedo and city cooling, Google Research (2025)", "https://research.google/pubs/estimating-high-resolution-albedo-for-urban-applications/")]},
    {"item": "Shaded bus stop",
     "value": f"₹{TYPES['shade_stop']['cost'] / 1e5:.0f} lakh each; removes its cell from heat exposure, no air cooling",
     "status": "cited",
     "why": "DTC approved solar bus shelters at ₹10 lakh each; stainless-steel stops were quoted at ₹20 lakh (2018).",
     "sources": [_src("DTC solar bus queue shelters, ₹10 lakh each", "https://indiaenvironmentportal.org.in/news-clippings/dtc-goes-for-solar-power"),
                 _src("Hindustan Times (2018): Delhi to build 1,397 bus stops itself", "https://www.pressreader.com/india/hindustan-times-delhi/20180330/281638190759894")]},
    {"item": "Stacking",
     "value": f"Cooling per cell levels off towards {COOLING_CAP_C} °C",
     "status": "modelling choice",
     "why": "A cell can only be so shaded. For scale: fully canopied vs treeless spots differ by 4–5 °C in air temperature.",
     "sources": [_src("Ziter et al. (2019), PNAS: canopy cover and urban heat", "https://www.sciencedaily.com/releases/2019/03/190325173305.htm")]},
    {"item": "Heat exposure",
     "value": f"Share of outdoor cells hotter than the block's {HOT_PERCENTILE}th-percentile surface temperature today",
     "status": "modelling choice",
     "why": "A relative 'hottest quarter' works on any block without a city-specific threshold. Measured at street level.", "sources": []},
    {"item": "Near a landmark",
     "value": f"Average cooling within ~{LANDMARK_RADIUS * 10} m (about a one-minute walk)",
     "status": "modelling choice", "why": "", "sources": []},
    {"item": "Street vs surface cooling",
     "value": "'Cooling' is averaged over streets, parks and open ground, where people are; the map also shows roof surfaces",
     "status": "modelling choice",
     "why": "Plans are judged by what people feel outdoors, so the AI optimises street cooling. Roofs still show their full surface effect on the map.",
     "sources": []},
    {"item": "Baseline heat",
     "value": "Satellite land-surface temperature, not air temperature",
     "status": "modelling choice",
     "why": "Surfaces swing far more than air: shaded vs sunlit pavement differ by 20 °C+, air by a few degrees.", "sources": []},
]


@dataclass
class Block:
    meta: dict
    lst: np.ndarray
    landcover: np.ndarray
    building_frac: np.ndarray
    roof_area: np.ndarray

    @classmethod
    def load(cls, path: Path) -> "Block":
        d = json.loads(path.read_text())
        arrays = {k: np.array(d.pop(k)) for k in ("lst_c", "landcover", "building_frac", "roof_area_m2")}
        return cls(d, arrays["lst_c"], arrays["landcover"], arrays["building_frac"], arrays["roof_area_m2"])

    @property
    def outdoor(self):
        return self.building_frac < OUTDOOR_BELOW

    def is_class(self, r, c, name):
        return self.meta["landcover_classes"][self.landcover[r, c]] == name

    def landcover_name(self, r, c):
        return self.meta["landcover_classes"][self.landcover[r, c]]


def _kernel(sigma):
    rad = int(np.ceil(3 * sigma))
    y, x = np.mgrid[-rad:rad + 1, -rad:rad + 1]
    return np.exp(-(x**2 + y**2) / (2 * sigma**2))  # peak 1 at the placed cell


KERNELS = {t: _kernel(s["sigma"]) for t, s in TYPES.items() if s["sigma"]}


def _validate(block: Block, placements):
    seen = set()
    for i, p in enumerate(placements):
        t, r, c = p["type"], p["row"], p["col"]
        where = f"placement {i} ({t} at {r},{c})"
        if t not in TYPES:
            raise ValueError(f"{where}: unknown type")
        if not (0 <= r < block.lst.shape[0] and 0 <= c < block.lst.shape[1]):
            raise ValueError(f"{where}: outside block")
        rule = RULES[t]
        if t == "tree":
            if not 1 <= p.get("count", 1) <= rule["max_count_per_cell"]:
                raise ValueError(f"{where}: count must be 1..{rule['max_count_per_cell']}")
            if block.building_frac[r, c] >= rule["blocked_building_frac_from"] or block.landcover_name(r, c) in rule["blocked_landcover"]:
                raise ValueError(f"{where}: no room for a tree here")
        else:
            if rule.get("unique_per_cell"):
                if (t, r, c) in seen:
                    raise ValueError(f"{where}: already placed in this cell")
                seen.add((t, r, c))
            if rule.get("requires_roof") and block.roof_area[r, c] <= 0:
                raise ValueError(f"{where}: no roof in this cell")
            if "allowed_landcover" in rule and block.landcover_name(r, c) not in rule["allowed_landcover"]:
                raise ValueError(f"{where}: bus stops go on roads")


def prices(unit_cost: dict | None = None) -> dict:
    """₹ per unit for each type: the sourced defaults, overridden by whatever the user set."""
    return {t: float((unit_cost or {}).get(t) or TYPES[t]["cost"]) for t in TYPES}


def simulate(block: Block, placements: list[dict], years: int = 10, unit_cost: dict | None = None) -> dict:
    _validate(block, placements)
    price = prices(unit_cost)
    grown = maturity(years)
    shape = block.lst.shape

    deposits = {t: np.zeros(shape) for t in KERNELS}
    shaded = np.zeros(shape, bool)
    trees = roof_m2 = stops = 0.0
    for p in placements:
        t, r, c = p["type"], p["row"], p["col"]
        if t == "tree":
            n = p.get("count", 1)
            trees += n
            deposits[t][r, c] += n * grown
        elif t == "cool_roof":
            deposits[t][r, c] += block.building_frac[r, c]
            roof_m2 += block.roof_area[r, c]
        else:
            shaded[r, c] = True
            stops += 1
    cost_parts = {"tree": trees * price["tree"], "cool_roof": roof_m2 * price["cool_roof"], "shade_stop": stops * price["shade_stop"]}
    cost = sum(cost_parts.values())

    block_m2 = block.lst.size * block.meta["cell_m"] ** 2
    added_canopy = trees * grown * CANOPY_M2_PER_TREE / block_m2  # share of the block the grown crowns cover
    aqi_gain = NOWAK_AQ_GAIN * added_canopy / NOWAK_CANOPY          # fraction cleaner air
    raw = sum(TYPES[t]["cool_c"] * convolve(d, KERNELS[t], mode="constant") for t, d in deposits.items())
    street = COOLING_CAP_C * (1 - np.exp(-raw / COOLING_CAP_C))      # what people feel: shade + roof spill-over
    surface = street + ROOF_SURFACE_C * deposits["cool_roof"]          # what the satellite sees: + the roofs themselves
    after = block.lst - street

    out = block.outdoor
    hot = np.percentile(block.lst[out], HOT_PERCENTILE)
    exposed_before = (out & (block.lst >= hot)).sum()
    exposed_after = (out & (after >= hot) & ~shaded).sum()

    temp_drop = float(street[out].mean())  # headline: average over streets, parks and open ground

    def near(lm):  # street cooling within LANDMARK_RADIUS of a landmark, outdoor cells only
        win = (slice(max(lm["row"] - LANDMARK_RADIUS, 0), lm["row"] + LANDMARK_RADIUS + 1),
               slice(max(lm["col"] - LANDMARK_RADIUS, 0), lm["col"] + LANDMARK_RADIUS + 1))
        o = out[win]
        return round(float(street[win][o].mean()), 2) if o.any() else 0.0
    return {
        "metrics": {
            "temp_reduction_c": round(temp_drop, 3),
            "peak_reduction_c": round(float(street[out].max()), 2),
            "surface_reduction_c": round(float(surface.mean()), 3),
            "roof_surface_reduction_c": round(float(surface.max()), 2) if roof_m2 else 0.0,
            "heat_exposure_pct": round(float(100 * exposed_after / out.sum()), 1),
            "heat_exposure_reduction_pct": round(float(100 * (exposed_before - exposed_after) / exposed_before), 1),
            "co2_captured_kg_per_year": round(trees * TREE_CO2_KG_YR * grown),
            "aqi_change": round(-aqi_gain * block.meta.get("baseline_aqi", 0), 3),
            "total_cost_inr": round(cost),
            "cost_per_degree_inr": round(cost / temp_drop) if temp_drop > 1e-6 else None,
            "landmark_cooling_c": {lm["name"]: near(lm) for lm in block.meta.get("landmarks", [])},
        },
        "cooling_grid": np.round(surface, 2).tolist(),  # the map shows surfaces, so painted roofs visibly cool
        # the inputs behind each metric, so the app can show "how this was calculated" with real numbers
        "breakdown": {
            "trees": int(trees), "roof_m2": round(float(roof_m2)), "stops": int(stops), "maturity": round(grown, 4),
            "canopy_m2_per_tree": CANOPY_M2_PER_TREE, "added_canopy_pct": round(added_canopy * 100, 2),
            "aq_gain_pct": round(aqi_gain * 100, 4), "nowak_gain_pct": NOWAK_AQ_GAIN * 100, "nowak_canopy_pct": NOWAK_CANOPY * 100,
            "baseline_aqi": block.meta.get("baseline_aqi", 0), "growth_tau": GROWTH_TAU_YEARS,
            "cells": int(street.size), "cell_m": block.meta["cell_m"], "roof_surface_c": ROOF_SURFACE_C,
            "tree_cool_c": TYPES["tree"]["cool_c"], "tree_reach_m": round(TYPES["tree"]["sigma"] * 3 * block.meta["cell_m"]),
            "roof_cool_c": TYPES["cool_roof"]["cool_c"], "cap_c": COOLING_CAP_C,
            "tree_co2_kg": TREE_CO2_KG_YR,
            "hot_threshold_c": round(float(hot), 1), "hot_percentile": HOT_PERCENTILE,
            "outdoor_cells": int(out.sum()), "exposed_before": int(exposed_before), "exposed_after": int(exposed_after),
            "unit_cost": {t: round(v) for t, v in price.items()},
            "cost_parts": {t: round(v) for t, v in cost_parts.items()},
        },
        "estimated": True,
    }
