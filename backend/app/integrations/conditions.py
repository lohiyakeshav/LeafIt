"""Live conditions for an area: air temperature (Open-Meteo, no key) and Indian AQI (Google Air Quality API).

Both degrade quietly: the area still builds, the UI just labels the number as a default.
"""
import logging
import time
from datetime import date, timedelta

import httpx

from app import config
from app.domain.area import climate

log = logging.getLogger("leafit.conditions")
TIMEOUT = httpx.Timeout(6.0)


async def fetch(lat: float, lng: float) -> dict:
    out = {"air_temp_c": None, "feels_like_c": None, "humidity_pct": None,
           "aqi": None, "aqi_source": None, "fetched_at": int(time.time())}   # no reading -> no AQI figure, never a made-up one
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


async def climate_normal(lat: float, lng: float) -> dict | None:
    """Hot-season climate of the place from three years of Open-Meteo archive data (no key): temperature, humidity, wind and
    the class (hot_dry / composite / humid) that decides the airflow rule for planting. None if the archive is unreachable."""
    months = climate.hot_months(lat)
    end = date.today() - timedelta(days=7)               # the archive lags a few days
    start = end - timedelta(days=3 * 365 + 1)           # three years back (replace(year=...) fails on 29 February)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
            r = await client.get("https://archive-api.open-meteo.com/v1/archive", params={
                "latitude": lat, "longitude": lng, "start_date": start.isoformat(), "end_date": end.isoformat(), "timezone": "UTC", "wind_speed_unit": "ms",
                "daily": "temperature_2m_max,relative_humidity_2m_mean,wind_speed_10m_max,wind_direction_10m_dominant"})
        d = r.raise_for_status().json()["daily"]
    except Exception as e:  # noqa: BLE001 - optional: planting rules then treat the climate as unknown
        log.warning("climate normals unavailable: %s", e)
        return None
    keep = [i for i, day in enumerate(d["time"]) if climate.in_months(int(day[5:7]), months)]
    def mean(key):
        vals = [d[key][i] for i in keep if d[key][i] is not None]
        return round(sum(vals) / len(vals), 1) if vals else None
    rh = mean("relative_humidity_2m_mean")
    return {"class": climate.classify(rh), "rh_pct": rh, "tmax_hot_c": mean("temperature_2m_max"), "wind_ms": mean("wind_speed_10m_max"),
            "wind_dir_deg": climate.mean_direction([d["wind_direction_10m_dominant"][i] for i in keep if d["wind_direction_10m_dominant"][i] is not None]),
            "months": list(months), "years": f"{start.year}-{end.year}"}
