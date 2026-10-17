"""Real suppliers near an area, from Places API (New) text search: nurseries, roof-coating/waterproofing contractors and
steel fabricators (who build bus shelters). Needs GOOGLE_MAPS_SERVER_KEY; without it there are no vendors (never made-up ones).

Results are cached in memory for a day per category and ~1 km of location, so browsing the vendor page doesn't repeat paid
searches. A vendor id carries its category ("nursery:<place id>"), so a quote can be written even after a restart.
"""
import logging
import time

import httpx

from app import config

log = logging.getLogger("leafit.vendors")
SEARCH = "https://places.googleapis.com/v1/places:searchText"
DETAILS = "https://places.googleapis.com/v1/places/{}"
FIELDS = ["id", "displayName", "formattedAddress", "location", "rating", "userRatingCount", "internationalPhoneNumber",
          "websiteUri", "googleMapsUri", "businessStatus"]
# category (as in the bill of materials) -> what a person would type into Google Maps to find one
QUERIES = {"nursery": "plant nursery", "roofing": "terrace waterproofing cool roof coating contractor", "shade": "steel fabrication works"}
SERVICES = {"nursery": "Plant nursery: saplings and planting", "roofing": "Roof coating and waterproofing",
            "shade": "Steel fabrication (shelters and canopies)"}
PER_CATEGORY = 10
BIAS_RADIUS_M = 25_000.0
CACHE_S = 24 * 3600
TIMEOUT = httpx.Timeout(10.0)

_cache: dict[tuple, tuple[float, list[dict]]] = {}
_by_id: dict[str, dict] = {}
_missing: dict[str, float] = {}   # ids a details lookup didn't find: not looked up again for a day (each lookup is billed)


def available() -> bool:
    return bool(config.GOOGLE_MAPS_SERVER_KEY)


def _vendor(place: dict, category: str) -> dict | None:
    loc = place.get("location") or {}
    if place.get("businessStatus", "OPERATIONAL") != "OPERATIONAL" or "latitude" not in loc:
        return None
    phone = "".join(ch for ch in place.get("internationalPhoneNumber", "") if ch.isdigit())
    return {"id": f"{category}:{place['id']}", "name": (place.get("displayName") or {}).get("text", "Unnamed"), "category": category,
            "services": SERVICES[category], "address": place.get("formattedAddress"), "lat": loc["latitude"], "lng": loc["longitude"],
            "rating": place.get("rating"), "ratings_count": place.get("userRatingCount", 0), "phone": phone or None,
            "website": place.get("websiteUri"), "maps_url": place.get("googleMapsUri"), "source": "google_places"}


def _headers() -> dict:
    return {"X-Goog-Api-Key": config.GOOGLE_MAPS_SERVER_KEY, "X-Goog-FieldMask": ",".join(f"places.{f}" for f in FIELDS)}


def search(category: str, lat: float, lng: float) -> list[dict]:
    """Up to PER_CATEGORY operational businesses of this category near (lat, lng); [] without a key or on failure."""
    if not available() or category not in QUERIES:
        return []
    key = (category, round(lat, 2), round(lng, 2))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1]
    try:
        r = httpx.post(SEARCH, headers=_headers(), timeout=TIMEOUT, json={
            "textQuery": QUERIES[category], "maxResultCount": PER_CATEGORY,
            "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": BIAS_RADIUS_M}}})
        found = [v for v in (_vendor(p, category) for p in r.raise_for_status().json().get("places", [])) if v]
    except Exception as e:  # noqa: BLE001 - the page says no vendors were found rather than failing
        log.warning("vendor search failed for %s: %s", category, e)
        return []
    _cache[key] = (time.time(), found)
    _by_id.update({v["id"]: v for v in found})
    return found


def get(vendor_id: str) -> dict | None:
    """A vendor by id: from the last searches, else looked up again by its place id."""
    if vendor_id in _by_id:
        return _by_id[vendor_id]
    category, _, place_id = vendor_id.partition(":")
    if (not available() or category not in QUERIES or not 10 <= len(place_id) <= 300
            or not place_id.replace("_", "").replace("-", "").isalnum() or time.time() - _missing.get(vendor_id, 0) < CACHE_S):
        return None
    try:
        r = httpx.get(DETAILS.format(place_id), timeout=TIMEOUT,
                      headers={"X-Goog-Api-Key": config.GOOGLE_MAPS_SERVER_KEY, "X-Goog-FieldMask": ",".join(FIELDS)})
        v = _vendor(r.raise_for_status().json(), category)
    except Exception as e:  # noqa: BLE001
        log.warning("vendor lookup failed for %s: %s", vendor_id, e)
        v = None
    if v:
        _by_id[vendor_id] = v
    else:
        _missing[vendor_id] = time.time()
    return v
