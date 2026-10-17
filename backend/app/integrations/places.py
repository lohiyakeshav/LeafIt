"""Landmarks inside an area (schools, clinics, markets, bus stops, parks) from Places API (New). Optional: needs a server key."""
import logging
import math

import httpx

from app import config
from app.domain.area.grid import Bounds, Grid

log = logging.getLogger("leafit.places")
MAX_LANDMARKS = 6
# Places type -> (our kind label, priority: lower comes first). The agent's brief can then say "protect the school".
KINDS = {"school": "school", "primary_school": "school", "secondary_school": "school", "hospital": "clinic", "doctor": "clinic",
         "bus_station": "bus stop", "bus_stop": "bus stop", "park": "park", "supermarket": "market", "market": "market"}
ORDER = ["school", "clinic", "bus stop", "market", "park"]


def pick(places: list[dict], grid: Grid) -> list[dict]:
    """Pure: keep places inside the grid, at most 2 per kind and MAX_LANDMARKS overall, as {name, kind, row, col}."""
    found, per_kind = [], {}
    for p in places:
        kind = next((KINDS[t] for t in p.get("types", []) if t in KINDS), None)
        loc = p.get("location") or {}
        cell = grid.cell_of(loc.get("latitude", 0), loc.get("longitude", 0)) if kind else None
        if not cell:
            continue
        found.append({"name": (p.get("displayName") or {}).get("text") or kind.title(), "kind": kind, "row": cell[0], "col": cell[1]})
    found.sort(key=lambda lm: ORDER.index(lm["kind"]))
    out = []
    for lm in found:
        if per_kind.get(lm["kind"], 0) < 2 and lm["name"] not in {o["name"] for o in out}:
            per_kind[lm["kind"]] = per_kind.get(lm["kind"], 0) + 1
            out.append(lm)
    return out[:MAX_LANDMARKS]


async def fetch_landmarks(bounds: Bounds, grid: Grid) -> list[dict]:
    if not config.GOOGLE_MAPS_SERVER_KEY:
        return []
    w, h = bounds.size_m
    lat, lng = bounds.center
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0)) as client:
            r = await client.post(
                "https://places.googleapis.com/v1/places:searchNearby",
                headers={"X-Goog-Api-Key": config.GOOGLE_MAPS_SERVER_KEY,
                         "X-Goog-FieldMask": "places.displayName,places.location,places.types"},
                json={"includedTypes": ["school", "hospital", "doctor", "bus_station", "park", "supermarket"], "maxResultCount": 20,
                      "locationRestriction": {"circle": {"center": {"latitude": lat, "longitude": lng},
                                                         "radius": min(50_000.0, math.hypot(w, h) / 2)}}})
            return pick(r.raise_for_status().json().get("places", []), grid)
    except Exception as e:  # noqa: BLE001
        log.warning("places lookup failed: %s", e)
        return []
