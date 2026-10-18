"""Funding proposal for a saved plan (municipal corporation / CSR sponsor), drafted by Gemini from simulator output only."""
import json
import logging

from app.integrations.gemini import MODEL, client, generate, unverified_numbers

PROMPT = """Write a one-page funding proposal in English, in Markdown, for a neighbourhood heat-action plan.
Audience: a municipal corporation officer or a corporate CSR committee in India.
Sections: Title; The problem (1 short paragraph); What we will do (bullets from the bill of materials);
Expected impact (bullets); Cost; Why this plan (cost-effectiveness); Next steps (vendors, timeline in phases, no dates).
Use ONLY the numbers in the JSON below. Never invent figures. Say clearly that impacts are model estimates.
If "place" is present use it: say what the area is like (climate, existing tree cover), name the tree species chosen when the bill of
materials lists them, and when residents are given say who benefits (and equity_cooling_c if present: cooling where vulnerable people live).
If "money" is present, quote every amount of money exactly as written there (already converted), never the INR figures.
Published studies of tree cooling differ, so metrics.low_estimate holds the low end of each cooling figure: always quote street cooling,
hottest spot and heat exposure as a range from the low_estimate value to the main value, never the main value alone.

JSON:
"""


SYMBOLS = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥", "CNY": "CN¥", "RUB": "₽", "AED": "AED ",
           "SAR": "SAR ", "QAR": "QAR ", "SGD": "SGD ", "AUD": "A$", "CAD": "CA$", "CHF": "CHF "}


def money(inr_amount: float, cur: dict | None) -> str:
    """An INR amount in the proposal's currency ({"code", "rate"} from /fx); INR when none was chosen."""
    code, rate = (cur or {}).get("code", "INR"), (cur or {}).get("rate", 1)
    x = inr_amount * rate
    return f"{SYMBOLS.get(code, code + ' ')}{x:,.0f}" if abs(x) >= 100 else f"{SYMBOLS.get(code, code + ' ')}{x:,.2f}"


def _template(ctx: dict) -> str:
    m = ctx["metrics"]
    cur = ctx.get("currency")
    roof_line = f"\n- Painted roofs: surfaces up to {m['roof_surface_reduction_c']} °C cooler" if m.get("roof_surface_reduction_c") else ""
    items = "\n".join(f"- {i['item']}: {i['quantity']:,} {i['unit']}" for i in ctx["bill_of_materials"])
    lo = m.get("low_estimate") or {}
    rng = lambda k: f"{lo[k]}–{m[k]}" if k in lo and lo[k] != m[k] else f"{m[k]}"   # low to high end of the published range
    per_lo = f"–{money(lo['cost_per_degree_inr'], cur)}" if lo.get("cost_per_degree_inr") else ""
    per = f"{money(m['cost_per_degree_inr'], cur)}{per_lo} per °C of street-level cooling" if m["cost_per_degree_inr"] else "n/a"
    return f"""# Heat-action plan: {ctx['block']}

## The problem
Dense, low-shade streets in {ctx['block']} reach high surface temperatures in summer, putting people who walk, wait and work outdoors at risk.

## What we will do
{items}

## Expected impact (model estimates, year {ctx['years']})
- Street-level cooling: {rng('temp_reduction_c')} °C on average across streets and open ground; up to {rng('peak_reduction_c')} °C at the most improved spots{roof_line}
- Outdoor area still heat-exposed: {m['heat_exposure_pct']}–{lo.get('heat_exposure_pct', m['heat_exposure_pct'])}% ({lo.get('heat_exposure_reduction_pct', m['heat_exposure_reduction_pct'])}–{m['heat_exposure_reduction_pct']}% less than today)
- CO₂ captured: {m['co2_captured_kg_per_year']:,} kg per year
- Air quality: {m['aqi_change'] if abs(m['aqi_change']) >= 0.05 else 0} AQI points

## Cost
{money(m['total_cost_inr'], cur)} in total ({per}).{'' if not cur or cur.get('code') == 'INR' else f" Converted from INR at the {cur.get('date')} rate."}

## Next steps
1. Approve the plan and release funds.
2. Request quotes from shortlisted local vendors through LeafIt.
3. Plant and install in phases, then track survival and temperatures.

*All impacts are estimates from the LeafIt grid model. Cooling is shown as a range because published studies differ; see "How we calculate this".*"""


def with_money(ctx: dict) -> dict:
    """Pre-formatted amounts in the chosen currency, so neither the template nor Gemini does currency arithmetic."""
    m, cur = ctx["metrics"], ctx.get("currency")
    return {**ctx, "money": {"total_cost": money(m["total_cost_inr"], cur),
                             "cost_per_degree_c": money(m["cost_per_degree_inr"], cur) if m["cost_per_degree_inr"] else None,
                             "unit_prices": {t: money(v, cur) for t, v in ctx.get("unit_prices_inr", {}).items()}}}


def write(ctx: dict, llm=None) -> dict:
    ctx = with_money(ctx)
    llm = llm or client()
    if llm:
        try:
            prompt = PROMPT + json.dumps(ctx, ensure_ascii=False)
            text = generate(llm, model=MODEL, contents=prompt).text.strip()
            return {"text": text, "source": "gemini", "unverified_numbers": unverified_numbers(text, ctx)}
        except Exception:
            logging.exception("Gemini proposal failed, using template")
    return {"text": _template(ctx), "source": "template", "unverified_numbers": []}
