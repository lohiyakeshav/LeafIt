"""Live conditions for an area: air temperature (Open-Meteo, no key) and Indian AQI (Google Air Quality API).

Both degrade quietly: the area still builds, the UI just labels the number as a default.
"""
import logging
import time

import httpx

from app import config

log = logging.getLogger("leafit.conditions")
DEFAULT_AQI = 178  # the demo block's baseline; used when no live reading is available
TIMEOUT = httpx.Timeout(6.0)


async def fetch(lat: float, lng: float) -> dict:
    out = {"air_temp_c": None, "feels_like_c": None, "humidity_pct": None,
           "aqi": DEFAULT_AQI, "aqi_source": "default", "fetched_at": int(time.time())}
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            r = await client.get("https://api.open-meteo.com/v1/forecast", params={
                "latitude": lat, "longitude": lng, "current": "temperature_2m,apparent_temperature,relative_humidity_2m"})
            cur = r.raise_for_status().json()["current"]
            out.update(air_temp_c=cur["temperature_2m"], feels_like_c=cur["apparent_temperature"], humidity_pct=cur["relative_humidity_2m"])
        except Exception as e:  # noqa: BLE001
            log.warning("weather lookup failed: %s", e)
        if config.GOOGLE_MAPS_SERVER_KEY:
            try:
                r = await client.post("https://airquality.googleapis.com/v1/currentConditions:lookup",
                                      params={"key": config.GOOGLE_MAPS_SERVER_KEY},
                                      json={"location": {"latitude": lat, "longitude": lng}, "extraComputations": ["LOCAL_AQI"],   # without this only the universal index comes back
                                            "customLocalAqis": [{"regionCode": "IN", "aqi": "ind_cpcb"}]})
                indexes = r.raise_for_status().json().get("indexes", [])
                local = next((i for i in indexes if i.get("code") == "ind_cpcb"), None)
                if local and local.get("aqi") is not None:
                    out.update(aqi=int(local["aqi"]), aqi_source="google_air_quality")
            except Exception as e:  # noqa: BLE001
                log.warning("air quality lookup failed: %s", e)
    return out
