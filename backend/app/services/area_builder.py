"""Turn a drawn rectangle into a block (the schema sim.py, optimise.py and the agent already understand) + building footprints."""
import asyncio
import logging
import time

import numpy as np
from fastapi.concurrency import run_in_threadpool

from app import config
from app.domain.area import synthetic
from app.domain.area.buildings import coverage
from app.domain.area.grid import CLASSES, Bounds, Grid, area_id, classify, make_grid, validate
from app.integrations import conditions, earthengine, places

log = logging.getLogger("leafit.area")


async def build_area(bounds: Bounds, name: str) -> dict:
    validate(bounds)
    grid, aid = make_grid(bounds), area_id(bounds)
    lat, lng = bounds.center

    async def satellite():
        try:
            return await run_in_threadpool(earthengine.fetch_layers, bounds, grid)
        except earthengine.EEUnavailable:
            if config.ALLOW_SYNTHETIC_AREAS:
                log.warning("Earth Engine unavailable: building SYNTHETIC area %s (LEAFIT_ALLOW_SYNTHETIC_AREAS is set)", aid)
                return None
            raise

    layers, cond, landmarks = await asyncio.gather(satellite(), conditions.fetch(lat, lng), places.fetch_landmarks(bounds, grid))
    block = _assemble(aid, name, grid, layers, landmarks, cond) if layers else _synthetic(aid, name, grid, landmarks, cond)
    block["built_at"] = int(time.time())
    return block


def _meta(aid: str, name: str, grid: Grid, cond: dict, landmarks: list[dict]) -> dict:
    return {"id": aid, "name": name, "kind": "area", "origin": {"lat": grid.north, "lng": grid.west},
            "bounds": {"north": grid.north, "south": grid.south, "east": grid.east, "west": grid.west},
            "cell_m": grid.cell_m, "rows": grid.rows, "cols": grid.cols, "landcover_classes": CLASSES,
            "baseline_aqi": cond["aqi"], "conditions": cond, "landmarks": landmarks}


def _assemble(aid, name, grid: Grid, layers: dict, landmarks, cond) -> dict:
    buildings = earthengine.buildings_from(layers, grid)
    bf = coverage(buildings, grid)
    lc = classify(layers["worldcover"], bf)
    # WorldCover says "tree" under the roofs we can see? The footprints win: keep it simple and trust the buildings.
    return {**_meta(aid, name, grid, cond, landmarks), "synthetic": False, "source": "earth_engine",
            "lst_period": layers["lst_period"], "landcover": lc.tolist(), "building_frac": np.round(bf, 2).tolist(),
            "roof_area_m2": np.round(bf * grid.cell_m**2, 1).tolist(), "lst_c": np.round(layers["lst"], 2).tolist(),
            "buildings": buildings}


def _synthetic(aid, name, grid: Grid, landmarks, cond) -> dict:
    g = synthetic.make(grid.rows, grid.cols, seed=int(aid[2:10], 16))
    g.pop("landmarks")
    g.pop("baseline_aqi")
    return {**_meta(aid, f"{name} (synthetic stand-in)", grid, cond, landmarks), **{k: v for k, v in g.items() if k not in ("rows", "cols", "cell_m", "landcover_classes")},
            "synthetic": True, "source": "synthetic"}
