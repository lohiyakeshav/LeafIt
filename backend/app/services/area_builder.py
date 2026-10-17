"""Turn a drawn rectangle into a block (the schema sim.py, optimise.py and the agent understand), its building footprints, the
shade and people around it, and a 150 m ring of surroundings.

Required: satellite heat, land cover and buildings. Everything else (canopy height, population, OSM roads, climate, landmarks)
is optional and its absence is recorded in `data_sources`, so the app and the agent never present a guess as a measurement.
"""
import asyncio
import logging
import math
import time

import numpy as np
from fastapi.concurrency import run_in_threadpool

from app.domain.area import canopy_grid, population, roads
from app.domain.area.buildings import coverage, floor_area
from app.domain.area.grid import BUILT, CLASSES, ROAD, Bounds, Grid, area_id, classify, make_grid, validate
from app.domain.sim import LEGACY_ROAD_CARRIAGEWAY
from app.integrations import conditions, earthengine, osm, places

log = logging.getLogger("leafit.area")

SCHEMA_VERSION = 2
ROAD_CELL_FROM = 0.25   # with OSM roads, a cell is a "road" cell (where bus shelters may go) from this carriageway share
MAX_LANDMARKS = 10
LANDMARKS_PER_KIND = 2
LANDMARK_ORDER = ["market", "bus stop", "school", "clinic", "park"]   # where people stand outdoors longest come first


async def build_area(bounds: Bounds, name: str) -> dict:
    validate(bounds)
    grid, aid = make_grid(bounds), area_id(bounds)
    lat, lng = bounds.center
    ring_grid = grid.padded(earthengine.RING_CELLS)

    layers, cond, landmarks, osm_data, clim = await asyncio.gather(
        run_in_threadpool(earthengine.fetch_layers, bounds, grid), conditions.fetch(lat, lng), places.fetch_landmarks(bounds, grid),
        osm.fetch(ring_grid), conditions.climate_normal(lat, lng))
    block = _assemble(aid, name, grid, layers, landmarks, cond, osm_data, clim)
    block["built_at"] = int(time.time())
    return block


def _meta(aid: str, name: str, grid: Grid, cond: dict, landmarks: list[dict], clim: dict | None) -> dict:
    return {"id": aid, "name": name, "kind": "area", "schema_version": SCHEMA_VERSION, "origin": {"lat": grid.north, "lng": grid.west},
            "bounds": {"north": grid.north, "south": grid.south, "east": grid.east, "west": grid.west},
            "cell_m": grid.cell_m, "rows": grid.rows, "cols": grid.cols, "landcover_classes": CLASSES,
            "baseline_aqi": cond["aqi"], "conditions": cond, "landmarks": landmarks, "climate": clim or {"class": None}}


def canopy_layers(ring: dict | None, pad: int, grid: Grid) -> tuple[np.ndarray, np.ndarray, str, float | None]:
    """(frac, height) over the RING grid, the source label, and how often it disagrees with WorldCover (a data-age hint)."""
    k = earthengine.CANOPY_SUBSAMPLE
    if ring is None:
        zeros = np.zeros((grid.rows + 2 * pad, grid.cols + 2 * pad))
        return zeros, zeros, "none", None
    fine = ring.get("canopy_fine")
    if fine is not None and canopy_grid.valid_share(fine) >= 0.9:
        frac, height = canopy_grid.aggregate(fine, k)
        source = "meta_wri"
    else:
        frac, height = canopy_grid.from_worldcover(ring["worldcover"])
        source = "worldcover"
    crop = lambda a: a[pad:pad + grid.rows, pad:pad + grid.cols]  # noqa: E731
    return frac, height, source, round(canopy_grid.disagreement(crop(frac), crop(ring["worldcover"])) * 100, 1)


def road_layers(osm_data: dict, ring_grid: Grid, pad: int, grid: Grid, lc: np.ndarray, bf: np.ndarray):
    """(carriageway over the ring, land cover with roads set from OSM, named roads, source). Falls back to land-cover roads."""
    crop = lambda a: a[pad:pad + grid.rows, pad:pad + grid.cols]  # noqa: E731
    if osm_data.get("ways"):
        cw_ring, named = roads.rasterise(osm_data["ways"], ring_grid)
        cw = crop(cw_ring)
        lc = lc.copy()
        lc[lc == ROAD] = BUILT                                              # land-cover "road" was a guess: OSM knows where roads are
        lc[(cw >= ROAD_CELL_FROM) & (bf < 0.5)] = ROAD
        shift = pad * grid.cell_m                                           # road points relative to the area's corner, not the ring's
        for r in named:
            r["points"] = [[round(x - shift, 1), round(z - shift, 1)] for x, z in r["points"]]
        return cw_ring, lc, named, "osm"
    cw = np.where(lc == ROAD, LEGACY_ROAD_CARRIAGEWAY, 0.0)
    return np.pad(cw, pad), lc, [], "landcover"


def people_layers(pop: dict | None, grid: Grid, buildings: list[dict]) -> dict | None:
    """population, vulnerable and exposure per cell, shared out by building floor area (see domain/area/population.py)."""
    if not pop:
        return None
    rows, cols = grid.rows, grid.cols
    lat_c = grid.north - (np.arange(rows)[:, None] + 0.5) * grid.dlat
    lng_c = grid.west + (np.arange(cols)[None, :] + 0.5) * grid.dlng
    d = pop["d"]
    ncols = pop["people"].shape[1]
    ci = np.broadcast_to(np.floor((lng_c - pop["x0"]) / d).astype(int), (rows, cols))
    cj = np.broadcast_to(np.floor((pop["y0"] - lat_c) / d).astype(int), (rows, cols))
    inside = (ci >= 0) & (ci < ncols) & (cj >= 0) & (cj < pop["people"].shape[0])
    idx = np.where(inside, cj * ncols + ci, -1)
    cells_per_pixel = (d * 111_320) ** 2 * math.cos(math.radians(grid.north)) / grid.cell_m**2
    floor = floor_area(buildings, grid)
    people = population.dasymetric(pop["people"].ravel(), idx, floor, cells_per_pixel)
    vulnerable = population.dasymetric(pop["vulnerable"].ravel(), idx, floor, cells_per_pixel)
    return {"population": people, "vulnerable": vulnerable, "exposure": population.exposure(vulnerable)}


def _landmarks(places_found: list[dict], osm_found: list[dict]) -> list[dict]:
    """Places and OpenStreetMap merged: at most LANDMARKS_PER_KIND of each kind (markets and bus stops first), no near-duplicates,
    Places names preferred (they are what people search for)."""
    out, count = [], {}
    for lm in sorted(places_found + osm_found, key=lambda lm: LANDMARK_ORDER.index(lm["kind"]) if lm["kind"] in LANDMARK_ORDER else 99):
        if len(out) >= MAX_LANDMARKS or count.get(lm["kind"], 0) >= LANDMARKS_PER_KIND:
            continue
        if not any(o["kind"] == lm["kind"] and abs(o["row"] - lm["row"]) + abs(o["col"] - lm["col"]) <= 6 for o in out):
            count[lm["kind"]] = count.get(lm["kind"], 0) + 1
            out.append(lm)
    return out


def _assemble(aid, name, grid: Grid, layers: dict, landmarks, cond, osm_data: dict, clim: dict | None) -> dict:
    ring = layers.get("ring")
    pad = ring["pad"] if ring else 0
    ring_grid = grid.padded(pad)
    crop = lambda a: a[pad:pad + grid.rows, pad:pad + grid.cols]  # noqa: E731
    buildings = earthengine.buildings_from(layers, grid)
    bf = coverage(buildings, grid)
    lc = classify(layers["worldcover"], bf)
    frac_ring, h_ring, canopy_source, disagree = canopy_layers(ring, pad, grid)
    cw_ring, lc, named_roads, roads_source = road_layers(osm_data, ring_grid, pad, grid, lc, bf)
    people = people_layers(layers.get("pop"), grid, buildings)
    block = {
        **_meta(aid, name, grid, cond, _landmarks(landmarks, osm.landmarks(osm_data.get("pois", []), grid)), clim),
        "source": "earth_engine", "lst_period": layers["lst_period"],
        "landcover": lc.tolist(), "building_frac": np.round(bf, 2).tolist(), "roof_area_m2": np.round(bf * grid.cell_m**2, 1).tolist(),
        "lst_c": np.round(layers["lst"], 2).tolist(), "buildings": buildings,
        "canopy_frac": np.round(crop(frac_ring), 2).tolist(), "canopy_h": np.round(crop(h_ring), 0).tolist(),
        "carriageway_frac": np.round(crop(cw_ring), 2).tolist(), "roads": named_roads,
        "canopy_source": canopy_source, "canopy_disagrees_with_worldcover_pct": disagree, "roads_source": roads_source,
        "population_source": "worldpop_2020" if people else None,
    }
    if ring:
        block["ring"] = {"pad": pad, "canopy_frac": np.round(frac_ring, 2).tolist(), "canopy_h": np.round(h_ring, 0).tolist(),
                         "lst_c": np.round(ring["lst"], 1).tolist(), "landcover": ring["worldcover"].tolist(),
                         "carriageway_frac": np.round(cw_ring, 2).tolist()}
    if people:
        stored = np.round(people["population"], 1)   # the total is taken from what is stored, so the two always agree
        block.update(population=stored.tolist(), vulnerable=np.round(people["vulnerable"], 1).tolist(),
                     exposure=np.round(people["exposure"], 3).tolist(), population_total=round(float(stored.sum())))
    return block

