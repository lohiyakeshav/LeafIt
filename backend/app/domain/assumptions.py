"""Every assumption behind LeafIt's numbers, with its source: served by GET /assumptions for the Method page.

status: "cited" (a source gives this value) · "derived" (computed from cited figures) · "estimate" (inside a cited range) ·
"modelling choice" (a design decision, not a measurement). Values are read from the code that uses them, so the page can't drift.
"""
from math import exp

from app.config import MODEL, SPECIES
from app.domain import optimise
from app.domain.area.buildings import CONFIDENCE_MIN, DEFAULT_HEIGHT_M
from app.domain.area.canopy_grid import TREE_MIN_M
from app.domain.sim import (
    AIR,
    CANOPY_M2_PER_TREE,
    COOLING_CAP_C,
    GROWTH_TAU_YEARS,
    HEAT_TRANSFER_W_M2K,
    HOT_PERCENTILE,
    LANDMARK_RADIUS,
    LEGACY_ROAD_CARRIAGEWAY,
    NOWAK_AQ_GAIN,
    NOWAK_CANOPY,
    ROOF_ALBEDO_GAIN,
    ROOF_SURFACE_C,
    SUN_W_M2,
    TREE_CO2_KG_YR,
    TYPES,
)


def _street_c(cool_c: float, cover: float) -> float:
    """Street cooling the model returns for ground uniformly `cover` under 50 m² crowns, after the per-cell levelling-off."""
    trees_per_cell = cover * MODEL["area"]["cell_m"] ** 2 / CANOPY_M2_PER_TREE
    return COOLING_CAP_C * (1 - exp(-cool_c * trees_per_cell / COOLING_CAP_C))


def _src(title, url):
    return {"title": title, "url": url}


ASSUMPTIONS = [
    # The three assumptions most worth challenging come first ("key": True); the page folds the rest away.
    {"item": "Tree cooling is shown as a range", "key": True,
     "value": f"Ground half under grown crowns cools at the surface by {_street_c(TYPES['tree']['cool_c_low'], 0.5):.2f} °C (low end) to "
              f"{_street_c(TYPES['tree']['cool_c'], 0.5):.1f} °C (high end); fully covered, {_street_c(TYPES['tree']['cool_c_low'], 1):.2f}–"
              f"{_street_c(TYPES['tree']['cool_c'], 1):.1f} °C",
     "status": "derived",
     "why": "Published estimates differ about eightfold. Low end: a Landsat 8 study using Bayesian hierarchical models on 900 m² urban units found "
            "that 450 m² of canopy (half the unit) lowers land-surface temperature by 0.268 °C (95% interval 0.241–0.295 °C), whatever the "
            "surrounding urban form. High end: across 293 European cities, tree-covered areas were 0–4 °C cooler at the surface than continuous "
            "built-up areas in southern Europe, the hot-summer climate closest to India; LeafIt sets half cover to half of that 4 °C top (2 °C) before cooling levels off per cell (see Stacking), which brings it to the figures above. The first measures what "
            "adding canopy does; the second compares tree areas with built-up ones. Each tree's share is spread over the cells around it, not added "
            "on top, so area-wide totals match the studies. Plans are optimised and compared on the high end.",
     "sources": [_src("Ruiz-Valero et al. (2026), Quantifying urban tree canopy cooling capacity using Bayesian hierarchical models and satellite imagery, Plants, People, Planet", "https://doi.org/10.1002/ppp3.70085"),
                 _src("Schwaab et al. (2021), The role of urban trees in reducing land surface temperatures in European cities, Nature Communications 12", "https://doi.org/10.1038/s41467-021-26768-w")]},
    {"item": "Air cooling is calibrated to one review, not measured here", "key": True,
     "value": f"Full canopy cools the air by ~1 °C, half canopy by ~0.6 °C; never more than {AIR['cap_c']} °C",
     "status": "estimate",
     "why": "A systematic review of field measurements found urban parks about 1 °C cooler than built-up surroundings by day. "
            "LeafIt sets its air curve so that a fully tree-covered area gives that 1 °C. The surface range is calibrated against "
            "satellite temperatures; the air figure is not, and it is not shown as a range.",
     "sources": [_src("Bowler et al. (2010), Urban greening to cool towns and cities, Landscape and Urban Planning 97(3)", "https://doi.org/10.1016/j.landurbplan.2010.05.006")]},
    {"item": "Existing trees come from satellite canopy data of varying age",
     "value": "Canopy cover and height per 10 m cell from Meta/WRI canopy-height maps (images mostly 2018–2020), else ESA WorldCover 2021 tree class",
     "status": "modelling choice",
     "why": "Trees planted or cut since the imagery are not seen. The source used is recorded for each area, and when the two sources disagree "
            "the planner is told. Existing shade counts first, so new trees next to it add less. Trees in the 150 m ring around the area count too. "
            f"Pixels at least {TREE_MIN_M:g} m tall count as canopy (lower is shrub or grass).",
     "sources": [_src("Tolan et al. (2024), Very high resolution canopy height maps from RGB imagery, Remote Sensing of Environment 300", "https://doi.org/10.1016/j.rse.2023.113888"),
                 _src("WRI Land & Carbon Lab: Meta tree canopy height dataset", "https://datasets.wri.org/datasets/meta-tree-canopy-height"),
                 _src("ESA WorldCover 10 m v200 (Earth Engine catalogue)", "https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCover_v200")]},
    {"item": "The humid-climate spacing limit is a rule, not a simulation", "key": True,
     "value": f"In humid climates, at most {round(MODEL['humid']['max_window_canopy'] * 100)}% of any {MODEL['humid']['window_cells']}×{MODEL['humid']['window_cells']}-cell window may be crown",
     "status": "modelling choice",
     "why": "A study of 138 Indian cities (2003–2020) found that dense, highly active canopy is linked to a higher heat index in humid city cores, "
            "where extra moisture is held near the ground. LeafIt does not model humidity or wind, so it limits canopy density in humid areas instead. "
            "The 50% limit is our choice, not a value from the study. The climate class (hot-dry, composite or humid) comes from Open-Meteo humidity normals.",
     "sources": [_src("Borah et al. (2026), Dense canopies reverse the cooling effect of urban greening in humid cities, Nature Communications 17", "https://doi.org/10.1038/s41467-026-72636-w"),
                 _src("Open-Meteo weather API", "https://open-meteo.com")]},
    {"item": "How far cooling reaches",
     "value": f"Spread over nearby cells, mostly gone by ~{TYPES['tree']['sigma'] * 10 * 3:.0f} m",
     "status": "estimate",
     "why": "Satellite studies find tree cooling significant up to 90 m from wooded green space; a 2024 study of parks found no measurable effect beyond 18 m. "
            "45 m sits between the two.",
     "sources": [_src("Gallay et al. (2023), Cooling effect and cooling distance of urban green spaces, Sustainability 15(4)", "https://doi.org/10.3390/su15043705"),
                 _src("Verma et al. (2024), Spatial configuration of urban parks and neighbourhood cooling, Landscape Ecology 39", "https://doi.org/10.1007/s10980-024-01818-y")]},
    {"item": "Stacking",
     "value": f"Cooling per cell levels off towards {COOLING_CAP_C} °C",
     "status": "modelling choice",
     "why": "A cell can only be so shaded. Across 293 European cities, tree-covered areas were at most about 4 °C cooler at the surface than "
            "built-up areas in southern Europe (8–12 °C in cooler central Europe), so cooling levels off towards the southern-Europe top.",
     "sources": [_src("Schwaab et al. (2021), The role of urban trees in reducing land surface temperatures in European cities, Nature Communications 12", "https://doi.org/10.1038/s41467-021-26768-w")]},
    {"item": "Tree growth",
     "value": f"Effect grows as 1 − e^(−years/{GROWTH_TAU_YEARS}): 34% by year 5, 57% by year 10, 81% by year 20",
     "status": "estimate",
     "why": "Street-tree height and crown growth slow during the second 15 years after planting, and linden crowns keep widening for decades. "
            f"The curve shape follows that; τ = {GROWTH_TAU_YEARS} years is our estimate, not a published value, and fast- and slow-growing species "
            f"use {SPECIES['growth_tau_years']['fast']} and {SPECIES['growth_tau_years']['slow']} years. Saplings often grow slowly in their first "
            "years, so years 1–3 may be overstated.",
     "sources": [_src("Peper, McPherson & Mori (2001), Equations for predicting diameter, height, crown width and leaf area of San Joaquin Valley street trees", "https://research.fs.usda.gov/treesearch/46301"),
                 _src("Larsen & Kristoffersen (2002), Tilia's physical dimensions over time, Journal of Arboriculture 28(5)", "https://auf.isa-arbor.com/content/28/5/209")]},
    {"item": "Tree CO₂",
     "value": f"{TREE_CO2_KG_YR} kg CO₂ per fully grown tree per year",
     "status": "derived",
     "why": f"US urban trees sequester on average 0.28 kg of carbon per m² of tree cover per year. One {CANOPY_M2_PER_TREE} m² crown × 0.28 × 44/12 "
            f"(carbon to CO₂) = {TREE_CO2_KG_YR} kg. This is a US national average; no equivalent measurement exists for Indian street trees.",
     "sources": [_src("Nowak et al. (2013), Carbon storage and sequestration by trees in urban and community areas of the United States, Environmental Pollution 178", "https://doi.org/10.1016/j.envpol.2013.03.019")]},
    {"item": "Air quality",
     "value": f"Best case {NOWAK_AQ_GAIN * 100:.2f}% cleaner air at {NOWAK_CANOPY * 100:.0f}% canopy, scaled to the canopy this plan adds "
              f"({CANOPY_M2_PER_TREE} m² per grown tree)",
     "status": "derived",
     "why": "Trees remove PM2.5 but barely move a city's air quality: modelled improvement was 0.05% (San Francisco) to 0.24% (Atlanta) across ten US cities. "
            f"We use the best case, Atlanta at {NOWAK_CANOPY:.1%} tree cover (the paper's Table 1), and scale it to the canopy this plan adds, so the figure is honest and small.",
     "sources": [_src("Nowak et al. (2013), Modeled PM2.5 removal by trees in ten U.S. cities and associated health effects, Environmental Pollution 178", "https://doi.org/10.1016/j.envpol.2013.03.050")]},
    {"item": "Tree cost",
     "value": f"₹{TYPES['tree']['cost']:,} per tree: sapling, metal guard, planting and 3 years of care",
     "status": "estimate",
     "why": "An IISc costing (2015) gives ₹200–400 sapling + ₹200 planting + ₹1,000 metal guard + ₹400 for 3 years' care = ₹1,800–2,000. "
            "MCD spent ₹2.77 crore on 6,39,659 saplings for the 2010 Commonwealth Games (~₹430 each, without guards). "
            "₹3,000 allows for price rises since 2015: get vendor quotes through LeafIt.",
     "sources": [_src("IISc ENVIS Technical Report 90 (2015): plantation costing", "https://wgbis.ces.iisc.ac.in/energy/water/paper/ETR90/sec7.html"),
                 _src("Lok Sabha unstarred question 3896 (2012): MCD Commonwealth Games planting", "https://eparlib.nic.in/bitstream/123456789/594902/1/98233.pdf")]},
    {"item": "Cool roof: roof surface",
     "value": f"{ROOF_SURFACE_C} °C cooler roof surface × roof share of the cell (shown on the map)",
     "status": "derived",
     "why": f"Surface energy balance: albedo gain {ROOF_ALBEDO_GAIN} (aged white coating vs concrete) × {SUN_W_M2} W/m² sun "
            f"÷ {HEAT_TRANSFER_W_M2K} W/m²K ≈ {ROOF_SURFACE_C} °C. Measurements agree it is conservative: Berkeley Lab found dark roofs up to ~50 °C "
            "above air temperature and reflective roofs ~11 °C above it.",
     "sources": [_src("Konopacki et al. (1998), Demonstration of energy savings of cool roofs, Lawrence Berkeley National Laboratory LBNL-40673", "https://www.osti.gov/biblio/296885")]},
    {"item": "Cool roof: at street level",
     "value": f"{TYPES['cool_roof']['cool_c']} °C × the roof's share of its cell, spread over ~{TYPES['cool_roof']['sigma'] * 10 * 3:.0f} m; "
              f"₹{TYPES['cool_roof']['cost']}/m²",
     "status": "estimate",
     "why": "A roof cools mostly itself and the rooms below (about 2 °C indoors in a 25-home Hyderabad pilot); its effect on the street is small: "
            "coating the largest roofs is modelled to cool cities by up to 0.5 °C. Cost is the ₹300/m² Telangana's 2023 Cool Roof Policy gives for "
            "cool paint or tiles.",
     "sources": [_src("Fork et al. (2026), Estimating high-resolution albedo for urban applications, Nature Communications (Google Research)", "https://research.google/pubs/estimating-high-resolution-albedo-for-urban-applications/"),
                 _src("NRDC: New cool roof programs in India, Hyderabad pilot", "https://www.nrdc.org/bio/anjali-jaiswal/new-cool-roof-programs-india-hyderabad-part-1"),
                 _src("Telangana Today (3 Apr 2023): India's first Cool Roof Policy, ₹300 per m²", "https://telanganatoday.com/indias-first-cool-roof-policy-launched-in-telangana")]},
    {"item": "Shaded bus stop",
     "value": f"₹{TYPES['shade_stop']['cost'] / 1e5:.0f} lakh each; removes its cell from heat exposure, no air cooling",
     "status": "cited",
     "why": "DTC approved solar bus queue shelters at ₹10 lakh each (2002). In 2018 Delhi's transport department put its standard shelter at "
            "~₹8 lakh and a stainless-steel one at ~₹20 lakh.",
     "sources": [_src("The Hindu via India Environment Portal (2002): DTC goes for solar power", "https://indiaenvironmentportal.org.in/news-clippings/dtc-goes-for-solar-power"),
                 _src("Hindustan Times (30 Mar 2018): After 4 failed tenders, govt to build 1,397 bus stops by itself", "https://www.pressreader.com/india/hindustan-times-delhi/20180330/281638190759894")]},
    {"item": "Where a tree fits",
     "value": "Carriageways and buildings are off limits; spacing sets how many trees fit in a cell, by species size class",
     "status": "modelling choice",
     "why": "A cell holds as many trees as crowns fit (spacing of 4.5–9 m by size class), limited by free ground after buildings, carriageway and existing canopy. "
            "Cells already ≥60% under canopy are closed. The first blocking reason is the one shown.",
     "sources": []},
    {"item": "Road widths are estimated",
     "value": f"Carriageway from an OpenStreetMap width tag, else lanes × {MODEL['lane_width_m']} m, else a default for the road type",
     "status": "modelling choice",
     "why": "Most Indian roads have no width tag, so type defaults (primary 14 m, secondary 10.5 m, tertiary 7.5 m, residential 5.5 m, service 4 m) are used. "
            "Footways and paths are not carriageway: their edges stay plantable. If OpenStreetMap can't be reached, a land-cover road cell "
            f"is taken as {LEGACY_ROAD_CARRIAGEWAY:.0%} carriageway (an estimate) and the area is rebuilt later.",
     "sources": [_src("OpenStreetMap wiki: Key:width", "https://wiki.openstreetmap.org/wiki/Key:width")]},
    {"item": "Species sizes and suitability",
     "value": "Nine native street trees, each with a size class, growth speed and climate suitability",
     "status": "estimate",
     "why": "Species come from the Delhi Forest Department's indigenous list and IISc's avenue-tree report. Neither gives crown spreads, so size class "
            "and growth speed are estimates. Only crown area and growth speed enter the model.",
     "sources": [_src(v["title"], v["url"]) for v in SPECIES.get("sources", {}).values()]},
    {"item": "Species mix",
     "value": "When LeafIt picks species it aims for no single species above 30% of a plan; the plan check shows the real share",
     "status": "modelling choice",
     "why": "One species everywhere could be wiped out by one pest. Urban foresters use Santamour's 10-20-30 guideline (at most 10% of any species, "
            "20% of a genus, 30% of a family); a global study of 151 inventories found most cities well above 10% for their top species. "
            "30% per species is what the seven to nine species that suit a climate can usually meet. Where most spots are narrow, a plan can stay "
            "above 30%: the plan check then reports the actual share.",
     "sources": [_src("Kendal, Dobbs & Lohr (2014), Is there evidence to support the 10/20/30 rule?, Urban Forestry & Urban Greening 13(3)", "https://doi.org/10.1016/j.ufug.2014.04.004")]},
    {"item": "Trees, roofs and shelters serve different people",
     "value": "Trees are ranked by street cooling per rupee; cool roofs for homes and shaded bus stops get a share of the budget the planner chooses",
     "status": "modelling choice",
     "why": "A cool roof barely cools the street but cools the rooms below; a shelter cools nobody's air but shades people who wait. "
            "There is no measured way to put them on one scale, so the planner decides the split: up to 60% of the budget for roofs on the "
            "homes with the most residents, and shelters at mapped bus stops (at most 40% of the budget, or one shelter when it costs half or less).",
     "sources": []},
    {"item": "People and vulnerable residents",
     "value": "WorldPop 100 m population with age and sex, shared onto buildings by floor area; shown per zone, not per cell",
     "status": "modelling choice",
     "why": "100 m pixels are split among the buildings inside them so each pixel's total is kept. Outdoor exposure is the number of residents within about 100 m. "
            "The equity figure is the average cooling in the most exposed quarter of cells (children under 5 and adults over 65 weigh most). "
            f"Buildings without a height in Open Buildings are taken as {DEFAULT_HEIGHT_M:g} m (about two storeys); footprints with "
            f"detection confidence below {CONFIDENCE_MIN} are left out.",
     "sources": [_src("WorldPop", "https://www.worldpop.org"), _src("Google Open Buildings", "https://sites.research.google/gr/open-buildings/")]},
    {"item": "How each planning goal ranks places",
     "value": "Cooling is valued where people are: every outdoor cell for 'average', the hottest outdoor ground for 'hotspots', "
              "residents and landmarks for 'people', children under 5 and adults over 65 for 'vulnerable'",
     "status": "modelling choice",
     "why": f"These weights set priorities, not physics: they decide where trees go, never how much a tree cools. 'People' gives every outdoor "
            f"cell {optimise.PEOPLE_FLOOR}, adds nearby residents and up to {optimise.POI_BOOST}× more beside schools, clinics, bus stops and "
            f"markets; 'vulnerable' gives {optimise.VULNERABLE_FLOOR} plus nearby vulnerable residents. A landmark the user names counts up to "
            f"{optimise.FOCUS_BOOST + 1}× within about {optimise.FOCUS_RADIUS_CELLS * 10} m, and a named zone {optimise.ZONE_BOOST}×.",
     "sources": []},
    {"item": "Baseline heat",
     "value": "Landsat 8/9 land-surface temperature, not air temperature: the cloud-free median of the hot season over the last three years",
     "status": "modelling choice",
     "why": "The hot season is April–June below 35° N (all of India), June–August further north and December–February south of the equator. "
            "Surfaces swing far more than air, so surface and air cooling are reported separately. Landsat passes over at about 10:00–10:15 "
            "local time, before the afternoon peak, so afternoon heat is higher than shown.",
     "sources": [_src("USGS Landsat 8 Level 2, Collection 2 (Earth Engine catalogue)", "https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LC08_C02_T1_L2")]},
    {"item": "Street vs surface cooling",
     "value": "'Cooling' is averaged over streets, parks and open ground, where people are; the map also shows roof surfaces",
     "status": "modelling choice",
     "why": "Plans are judged by what people feel outdoors, so the planner optimises street cooling. Roofs still show their full surface effect on the map.",
     "sources": []},
    {"item": "Heat exposure",
     "value": f"Share of outdoor cells hotter than the area's {HOT_PERCENTILE}th-percentile surface temperature before the plan",
     "status": "modelling choice",
     "why": "A relative 'hottest quarter' works on any area without a city-specific threshold, but it can't be compared between areas.", "sources": []},
    {"item": "Near a landmark",
     "value": f"Average cooling within ~{LANDMARK_RADIUS * 10} m (about a one-minute walk)",
     "status": "modelling choice", "why": "", "sources": []},
]
