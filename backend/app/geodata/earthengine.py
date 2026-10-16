"""Real satellite layers for an area, from Google Earth Engine.

  lst_c        Landsat 8+9 Collection 2 Level 2 surface temperature, cloud-masked, hot-season median of the last 3 years
  worldcover   ESA WorldCover v200 (10 m land cover)
  buildings    Google Open Buildings v3 footprints (confidence >= 0.75), heights from Open Buildings 2.5D Temporal

Everything blocking runs in a worker thread (see area_builder). Pure helpers at the bottom are unit-tested offline;
the Earth Engine calls themselves are exercised by scripts/ee_smoke.py against a real project.
"""
import json
import logging
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import numpy as np
from scipy.ndimage import gaussian_filter

from .. import config
from .buildings import parse_features
from .grid import Bounds, Grid, make_grid

log = logging.getLogger("leafit.ee")

CONFIDENCE_MIN = 0.75
TILE_M = 500        # buildings are queried in ~500 m tiles: one query may not return more than 5000 features
HEIGHT_CELL_M = 4   # Open Buildings 2.5D Temporal is a 4 m raster
_init_lock, _ready = threading.Lock(), False


class EEUnavailable(Exception):
    """Earth Engine can't be used right now (no credentials, no permission, no clear pixels...). Message is user-safe."""


def _init():
    global _ready
    with _init_lock:
        if _ready:
            return
        try:
            import ee
            key = config.EE_KEY_FILE
            if key and key.exists():
                info = json.loads(key.read_text())
                creds = ee.ServiceAccountCredentials(info["client_email"], str(key))
                ee.Initialize(creds, project=config.EE_PROJECT or info["project_id"])
            else:
                ee.Initialize(project=config.EE_PROJECT)
        except Exception as e:  # noqa: BLE001 - every failure mode means the same thing to the caller
            log.error("Earth Engine init failed: %s", e)
            raise EEUnavailable("The satellite data service isn't reachable right now.") from e
        _ready = True


def hot_months(lat: float) -> tuple[int, int]:
    """Months (inclusive, may wrap the year) used for the 'hot season' baseline."""
    if lat < 0:
        return (12, 2)
    return (4, 6) if lat < 35 else (6, 8)


def fetch_layers(bounds: Bounds, grid: Grid) -> dict:
    """-> {"lst": rows×cols °C, "worldcover": rows×cols codes, "features": [...], "height_at": f(lat, lng), "lst_period": str}"""
    _init()
    import ee
    try:
        region = ee.Geometry.Rectangle([grid.west, grid.south, grid.east, grid.north])
        months = hot_months(bounds.center[0])
        this_year = date.today().year

        def prep(img):
            clear = img.select("QA_PIXEL").bitwiseAnd(0b11110).eq(0)  # dilated cloud, cirrus, cloud, cloud shadow
            # resample each scene while it still has its native 30 m grid; on the composite there is no grid to interpolate
            st = img.select("ST_B10").multiply(0.00341802).add(149.0).subtract(273.15).resample("bilinear")
            return st.updateMask(clear).updateMask(st.gt(0).And(st.lt(80))).rename("lst")

        season = (ee.Filter.calendarRange(months[0], months[1], "month") if months[0] <= months[1] else
                  ee.Filter.Or(ee.Filter.calendarRange(months[0], 12, "month"), ee.Filter.calendarRange(1, months[1], "month")))
        lst = (ee.ImageCollection("LANDSAT/LC08/C02/T1_L2").merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
               .filterBounds(region).filterDate(f"{this_year - 3}-01-01", f"{this_year}-01-01").filter(season)
               .map(prep).median())
        wc = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map").rename("wc")
        stack = ee.Image.cat([lst.rename("lst").toFloat(), wc.toFloat()])

        with ThreadPoolExecutor(max_workers=6) as pool:
            f_pixels = pool.submit(_pixels, stack, grid)
            f_height = pool.submit(_height_raster, bounds)
            f_feats = [pool.submit(_building_tile, t) for t in _tiles(bounds)]
            px = f_pixels.result()
            height_grid, height = f_height.result()
            features = [f for fut in f_feats for f in fut.result()]
    except EEUnavailable:
        raise
    except Exception as e:  # noqa: BLE001
        log.error("Earth Engine fetch failed: %s", e)
        raise EEUnavailable("The satellite data service isn't reachable right now.") from e

    def height_at(lat, lng):
        cell = height_grid.cell_of(lat, lng)
        return float(height[cell]) if cell and np.isfinite(height[cell]) and height[cell] > 0 else None

    return {"lst": fill_gaps(px["lst"]), "worldcover": np.nan_to_num(px["wc"], nan=0).astype(int),
            "features": features, "height_at": height_at,
            "lst_period": f"{this_year - 3}-{this_year - 1}, months {months[0]}-{months[1]}"}


def _pixels(image, grid: Grid) -> dict:
    import ee
    return ee.data.computePixels({
        "expression": image, "fileFormat": "NUMPY_NDARRAY",
        "grid": {"dimensions": {"width": grid.cols, "height": grid.rows},
                 "affineTransform": {"scaleX": grid.dlng, "shearX": 0, "translateX": grid.west,
                                     "shearY": 0, "scaleY": -grid.dlat, "translateY": grid.north},
                 "crsCode": "EPSG:4326"}})


def _height_raster(bounds: Bounds):
    import ee
    g = make_grid(bounds, HEIGHT_CELL_M)
    img = (ee.ImageCollection("GOOGLE/Research/open-buildings-temporal/v1")
           .filterBounds(ee.Geometry.Point(bounds.center[::-1])).select("building_height").sort("system:time_start").mosaic()  # mosaic: last image wins, so latest year on top
           .rename("h").toFloat())
    return g, _pixels(img, g)["h"]


def _tiles(b: Bounds) -> list[Bounds]:
    w, h = b.size_m
    nx, ny = max(1, math.ceil(w / TILE_M)), max(1, math.ceil(h / TILE_M))
    dlng, dlat = (b.east - b.west) / nx, (b.north - b.south) / ny
    return [Bounds(b.north - j * dlat, b.north - (j + 1) * dlat, b.west + (i + 1) * dlng, b.west + i * dlng)
            for j in range(ny) for i in range(nx)]


def _building_tile(t: Bounds) -> list[dict]:
    import ee
    fc = (ee.FeatureCollection("GOOGLE/Research/open-buildings/v3/polygons")
          .filterBounds(ee.Geometry.Rectangle([t.west, t.south, t.east, t.north]))
          .filter(ee.Filter.gte("confidence", CONFIDENCE_MIN)).limit(5000))
    return fc.getInfo()["features"]


def buildings_from(layers: dict, grid: Grid) -> list[dict]:
    return parse_features(layers["features"], grid, layers["height_at"])


def fill_gaps(lst: np.ndarray) -> np.ndarray:
    """Cloud-masked pixels come back NaN. Fill from neighbours; if nothing is clear at all, say so."""
    bad = ~np.isfinite(lst)
    if bad.all():
        raise EEUnavailable("No clear satellite heat readings exist for this area yet. Try a different area.")
    if not bad.any():
        return lst
    # normalised convolution: smooth the valid values, divide by the smoothed validity mask
    sigma = max(2.0, min(lst.shape) / 8)
    num = gaussian_filter(np.where(bad, 0.0, lst), sigma)
    den = gaussian_filter((~bad).astype(float), sigma)
    filled = np.where(den > 1e-3, num / np.maximum(den, 1e-3), np.nanmean(lst))
    return np.where(bad, filled, lst)
