"""OpenStreetMap through Overpass: road geometry (for carriageway share and road names) and the places people gather.

Both are optional: if Overpass is slow or down the area still builds, falling back to land-cover roads, and says so.
"""
import asyncio
import logging

import httpx

from app.domain.area.grid import Grid

log = logging.getLogger("leafit.osm")

# Public Overpass servers are free and each one fails some requests (measured: the fast mirrors answer in 1-2 s or fail with a 500 within
# 1 s, at random; the main server answers in seconds or times out). So retry the fast ones many times and give the slow one a single go last.
FAST = ["https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
SLOW = "https://overpass-api.de/api/interpreter"
ROUNDS = 6
RETRY_DELAY_S = 0.3
TIMEOUT = httpx.Timeout(8.0, connect=4.0)
DEADLINE_S = 40.0   # roads are optional: never let them hold up an area build for longer than this
ROAD_TYPES = "motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service"   # carriageways only, not footpaths
HEADERS = {"User-Agent": "LeafIt/0.2 (urban heat planning prototype)", "Accept": "application/json"}   # Overpass rejects anonymous clients
# OSM tag -> our landmark kind
POI_TAGS = {"school": "school", "hospital": "clinic", "clinic": "clinic", "doctors": "clinic", "marketplace": "market", "bus_station": "bus stop"}
KIND_ORDER = ["market", "bus stop", "school", "clinic"]


def _bbox(g: Grid) -> str:
    return f"{g.south},{g.west},{g.north},{g.east}"


def query(ring_grid: Grid) -> str:
    """One request for roads (with geometry) and places (with a centre point): a single call is kinder to the public server."""
    bb = _bbox(ring_grid)
    return (f'[out:json][timeout:25];way["highway"~"^({ROAD_TYPES})(_link)?$"]({bb});out geom tags;'
            f'(nwr["amenity"~"^(school|hospital|clinic|doctors|marketplace|bus_station)$"]({bb});node["highway"="bus_stop"]({bb}););out center tags;')


async def _post(client: httpx.AsyncClient, q: str) -> list[dict]:
    """POST to the fast mirrors in turn, ROUNDS times, then once to the slow one; raises the last error if every attempt fails."""
    last: Exception | None = None
    tries = [u for _ in range(ROUNDS) for u in FAST] + [SLOW]
    for url in tries:
        try:
            r = await client.post(url, data={"data": q})
            return r.raise_for_status().json().get("elements", [])
        except Exception as e:  # noqa: BLE001 - try the next one
            last = e
            await asyncio.sleep(RETRY_DELAY_S)
    raise last or RuntimeError("no Overpass endpoint answered")


def split(elements: list[dict]) -> tuple[list[dict], list[dict]]:
    """(roads, places) from one Overpass answer: roads are ways with geometry, places are everything else."""
    ways = [e for e in elements if e.get("type") == "way" and "geometry" in e and "highway" in e.get("tags", {})]
    pois = [e for e in elements if not (e.get("type") == "way" and "geometry" in e)]
    return ways, pois


async def fetch(ring_grid: Grid) -> dict:
    """{"ways": [...highway ways with geometry], "pois": [...], "ok": bool} for the area and its ring."""
    try:
        # no keep-alive: a retry must open a NEW connection, or it lands on the same failing backend again (measured)
        async with httpx.AsyncClient(timeout=TIMEOUT, headers=HEADERS, limits=httpx.Limits(max_keepalive_connections=0)) as client:
            ways, pois = split(await asyncio.wait_for(_post(client, query(ring_grid)), DEADLINE_S))
        return {"ways": ways, "pois": pois, "ok": True}
    except Exception as e:  # noqa: BLE001 - optional layer
        log.warning("Overpass unavailable, building without OSM roads and places: %r", e)
        return {"ways": [], "pois": [], "ok": False}


def landmarks(pois: list[dict], grid: Grid, per_kind: int = 2) -> list[dict]:
    """Up to `per_kind` named places of each kind inside the area, as {name, kind, row, col}."""
    found = []
    for p in pois:
        tags = p.get("tags", {})
        kind = "bus stop" if tags.get("highway") == "bus_stop" else POI_TAGS.get(tags.get("amenity", ""))
        lat, lon = (p.get("lat"), p.get("lon")) if "lat" in p else ((p.get("center") or {}).get("lat"), (p.get("center") or {}).get("lon"))
        cell = grid.cell_of(lat, lon) if kind and lat is not None else None
        name = tags.get("name") or (f"Bus stop ({tags['ref']})" if kind == "bus stop" and tags.get("ref") else "Bus stop" if kind == "bus stop" else None)
        if cell and name:   # bus stops are often mapped without a name; they still matter
            found.append({"name": name, "kind": kind, "row": cell[0], "col": cell[1]})
    found.sort(key=lambda lm: KIND_ORDER.index(lm["kind"]))
    out, count = [], {}
    for lm in found:
        if count.get(lm["kind"], 0) < per_kind and not any(o["kind"] == lm["kind"] and abs(o["row"] - lm["row"]) + abs(o["col"] - lm["col"]) <= 3 for o in out):
            count[lm["kind"]] = count.get(lm["kind"], 0) + 1
            names = {o["name"] for o in out}
            out.append({**lm, "name": lm["name"] if lm["name"] not in names else f"{lm['name']} {count[lm['kind']]}"})
    return out
