"""Exchange rates for showing money in the user's currency. All maths stays in INR; this only converts for display.

Today's rates are fetched once a day (exchangerate-api.com open endpoint, no key) and recorded by the repository.
If the source is unreachable we serve the most recent recorded day, and failing that INR only.
"""
import logging
from datetime import date

import httpx

from app.repositories import FxRateRepository

log = logging.getLogger("leafit.fx")

SOURCE = "https://open.er-api.com/v6/latest/INR"
CURRENCIES = ["INR", "USD", "EUR", "GBP", "JPY", "CNY", "RUB", "AED", "SAR", "QAR", "SGD", "AUD", "CAD", "CHF"]


class FxService:
    def __init__(self, rates: FxRateRepository):
        self.rates = rates

    async def get_fx_rates(self) -> dict:
        """{"base": "INR", "date", "rates": {code: units per 1 INR}, ...}; adds "stale": True when served from an older day."""
        day = date.today().isoformat()
        if rec := self.rates.get_rates(day):
            return rec
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                d = (await client.get(SOURCE)).raise_for_status().json()
            if d.get("result") != "success":
                raise ValueError(d.get("error-type", "bad response"))
            rec = {"base": "INR", "date": day, "updated": d.get("time_last_update_utc"), "source": "exchangerate-api.com",
                   "rates": {c: d["rates"][c] for c in CURRENCIES if c in d["rates"]}}
            self.rates.save_rates(rec)
            return rec
        except Exception as e:  # noqa: BLE001 - any failure: fall back to the last recorded day
            log.warning("live FX unavailable: %s", e)
            return {**(self.rates.get_rates() or {"base": "INR", "date": None, "rates": {"INR": 1.0}}), "stale": True}

    async def get_currency(self, code: str) -> dict | None:
        """{"code", "rate", "date"} for converting INR amounts, or None for INR / an unknown code (amounts stay in INR)."""
        if code == "INR":
            return None
        rates = await self.get_fx_rates()
        rate = rates.get("rates", {}).get(code)
        return {"code": code, "rate": rate, "date": rates.get("date")} if rate else None
