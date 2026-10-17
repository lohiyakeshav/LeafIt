"""Grid surrogate model (PRD §8). Fast, explainable, labelled 'estimated' in the UI."""
import json
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

import numpy as np
from scipy.ndimage import convolve

from app.config import MODEL, SPECIES
from app.domain import canopy, plantable
from app.domain import species as species_mod

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
AIR = MODEL["air"]
LEGACY_ROAD_CARRIAGEWAY = 0.45   # areas without OSM road data: a land-cover road cell is ~half carriageway, half footpath (an estimate)


def maturity(years: int) -> float:
    """Share of a tree's full effect after `years`: 8% in year 1, 34% by 5, 57% by 10, 81% by 20."""
    return float(1 - np.exp(-max(years, 1) / GROWTH_TAU_YEARS))


def _src(title, url):
    return {"title": title, "url": url}


# Served by GET /assumptions for the "How we calculate this" screen.
# status: "cited" (a source gives this value) · "derived" (computed from cited figures) ·
#         "estimate" (best guess inside a cited range) · "modelling choice" · "under review"
ASSUMPTIONS = [
    # The three assumptions most worth challenging come first ("key": True); the page folds the rest away.
    {"item": "Air cooling is a literature ceiling, not a measurement", "key": True,
     "value": f"Air cools at most ~{MODEL['air']['cap_c']} °C under dense canopy; trees ~8 m apart give roughly 0.4–0.8 °C",
     "status": "estimate",
     "why": "Reviews of urban greening measure air cooling of about 1 °C in parks, 0.8 °C for street trees and ~1.6 °C for urban forest. "
            "LeafIt uses one saturating curve with that ceiling, set so a typical street lands inside the street-tree range. "
            "The surface figure is calibrated against satellite temperatures; the air figure is not.",
     "sources": [_src("Bowler et al. (2010), Urban greening to cool towns and cities, Landscape and Urban Planning", "https://doi.org/10.1016/j.landurbplan.2010.05.006")]},
    {"item": "Existing trees come from satellite canopy data of varying age", "key": True,
     "value": "Canopy cover and height per 10 m cell from Meta/WRI (images mostly 2018–2020), else ESA WorldCover 2021 tree class",
     "status": "modelling choice",
     "why": "Trees planted or cut since the imagery are not seen. The source used is recorded for each area, and when the two sources disagree "
            "the planner is told. Existing shade counts first, so new trees next to it add less. Trees in the 150 m ring around the area count too.",
     "sources": []},
    {"item": "The humid-climate spacing limit is a rule, not a simulation", "key": True,
     "value": f"In humid climates, at most {round(MODEL['humid']['max_window_canopy'] * 100)}% of any {MODEL['humid']['window_cells']}×{MODEL['humid']['window_cells']}-cell window may be crown",
     "status": "modelling choice",
     "why": "Studies of Indian cities find dense canopy cools dry cities but can raise the heat index where humidity is high, by blocking air movement. "
            "LeafIt does not model wind. It limits canopy density in humid areas so streets stay open. The climate class (hot-dry, composite or humid) comes from "
            "Open-Meteo humidity normals and only switches this rule on.",
     "sources": []},
    {"item": "Where a tree fits",
     "value": "Carriageways and buildings are off limits; spacing sets how many trees fit in a cell, by species size class",
     "status": "modelling choice",
     "why": "A cell holds as many trees as crowns fit (spacing of 6–12 m by size class), limited by free ground after buildings, carriageway and existing canopy. "
            "Cells already ≥60% under canopy are closed. The first blocking reason is the one shown.",
     "sources": []},
    {"item": "Road widths are estimated",
     "value": "Carriageway from an OpenStreetMap width tag, else lanes × 3.5 m, else a default for the road type",
     "status": "modelling choice",
     "why": "Most Indian roads have no width tag, so type defaults (primary 14 m, secondary 10.5 m, tertiary 7.5 m, residential 5.5 m, service 4 m) are used. "
            "Footways and paths are not carriageway: their edges stay plantable.",
     "sources": []},
    {"item": "Species sizes and suitability",
     "value": "Eight to ten native street trees, each with a size class, growth speed and climate suitability",
     "status": "estimate",
     "why": "Where the sources below give no crown figure, the size class is an estimate. Only crown area and growth speed enter the model; "
            "evapotranspiration is not modelled. Pick a species yourself or let LeafIt choose the best fit for each spot.",
     "sources": [_src(v["title"], v["url"]) for v in SPECIES.get("sources", {}).values()]},
    {"item": "Trees, roofs and shelters serve different people",
     "value": "Trees are ranked by street cooling per rupee; cool roofs for homes and shaded bus stops get a share of the budget the planner chooses",
     "status": "modelling choice",
     "why": "A cool roof barely cools the street but cools the rooms below; a shelter cools nobody's air but shades people who wait. "
            "Putting them on one scale would need a conversion nobody has measured, so the AI weighs them against the brief: up to 60% of the "
            "budget for roofs on the homes with the most residents (or vulnerable residents), and shelters at mapped bus stops first "
            "(at most 40% of the budget, or one shelter when it costs half or less).",
     "sources": []},
    {"item": "Species mix",
     "value": "When LeafIt picks species it aims for no single species above 30% of a plan; the plan check shows the real share",
     "status": "modelling choice",
     "why": "The best-shading species everywhere would make a monoculture that one pest or disease could wipe out. Urban foresters follow "
            "Santamour's 10-20-30 rule (at most 10% of any species, 20% of a genus, 30% of a family); 30% per species is what the "
            "seven to nine species that suit a climate can usually meet. Trees move to the next-best species where that costs least shade. "
            "A whole cell moves at once and must fit its trees, so where most spots are narrow (only small and medium crowns fit) a plan "
            "can stay above 30%: the plan check then reports the actual share and suggests mixing species by hand.",
     "sources": []},
    {"item": "People and vulnerable residents",
     "value": "WorldPop 100 m population with age and sex, shared onto buildings by floor area; shown per zone, not per cell",
     "status": "modelling choice",
     "why": "100 m pixels are split among the buildings inside them so each pixel's total is kept. Outdoor exposure is the number of residents within about 100 m. "
            "The equity figure is the average cooling in the most exposed quarter of cells (children under 5 and adults over 65 weigh most). "
            "Buildings without a height in Open Buildings are taken as 6 m (about two storeys) when sharing people out.",
     "sources": []},
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
    new_surface = (TYPES["tree"]["cool_c"] * convolve(tree_units, KERNELS["tree"], mode="constant")
                   + TYPES["cool_roof"]["cool_c"] * convolve(roof_dep, KERNELS["cool_roof"], mode="constant"))
    new_air = AIR["per_tree_c"] * convolve(tree_units, AIR_KERNEL, mode="constant")
    street = canopy.marginal(existing_surface, new_surface, COOLING_CAP_C)   # what people feel: shade + roof spill-over
    air = canopy.marginal(existing_air, new_air, AIR["cap_c"])                # air temperature: a smaller, wider effect
    surface = street + ROOF_SURFACE_C * roof_dep                              # what the satellite sees: + the roofs themselves
    return Evaluation(street, air, surface, shaded, trees, roof_m2, stops, crown_m2_grown, co2_kg, by_species, cost_parts, price, grown)


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
            "tree_cool_c": TYPES["tree"]["cool_c"], "tree_reach_m": round(TYPES["tree"]["sigma"] * 3 * block.meta["cell_m"]),
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
