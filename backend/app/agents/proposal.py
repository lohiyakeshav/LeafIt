"""Funding proposal for a saved plan (municipal corporation / CSR sponsor), drafted by Gemini from simulator output only."""
import json
import logging

from .gemini import MODEL, client, unverified_numbers

PROMPT = """Write a one-page funding proposal in English, in Markdown, for a neighbourhood heat-action plan.
Audience: a municipal corporation officer or a corporate CSR committee in India.
Sections: Title; The problem (1 short paragraph); What we will do (bullets from the bill of materials);
Expected impact (bullets); Cost; Why this plan (cost-effectiveness); Next steps (vendors, timeline in phases, no dates).
Use ONLY the numbers in the JSON below. Never invent figures. Say clearly that impacts are model estimates.

JSON:
"""


def _template(ctx: dict) -> str:
    m = ctx["metrics"]
    roof_line = f"\n- Painted roofs: surfaces up to {m['roof_surface_reduction_c']} °C cooler" if m.get("roof_surface_reduction_c") else ""
    items = "\n".join(f"- {i['item']}: {i['quantity']:,} {i['unit']}" for i in ctx["bill_of_materials"])
    per = f"₹{m['cost_per_degree_inr']:,} per °C of street-level cooling" if m["cost_per_degree_inr"] else "n/a"
    return f"""# Heat-action plan: {ctx['block']}

## The problem
Dense, low-shade streets in {ctx['block']} reach high surface temperatures in summer, putting people who walk, wait and work outdoors at risk.

## What we will do
{items}

## Expected impact (model estimates, year {ctx['years']})
- Street-level cooling: {m['temp_reduction_c']} °C on average across streets and open ground; up to {m['peak_reduction_c']} °C at the most improved spots{roof_line}
- Outdoor area still heat-exposed: {m['heat_exposure_pct']}% ({m['heat_exposure_reduction_pct']}% less than today)
- CO₂ captured: {m['co2_captured_kg_per_year']:,} kg per year
- Air quality: {m['aqi_change'] if abs(m['aqi_change']) >= 0.05 else 0} AQI points

## Cost
₹{m['total_cost_inr']:,} in total ({per}).

## Next steps
1. Approve the plan and release funds.
2. Request quotes from shortlisted local vendors through LeafIt.
3. Plant and install in phases, then track survival and temperatures.

*All impacts are estimates from the LeafIt grid model; see "How we calculate this".*"""


def write(ctx: dict, llm=None) -> dict:
    llm = llm or client()
    if llm:
        try:
            prompt = PROMPT + json.dumps(ctx, ensure_ascii=False)
            text = llm.models.generate_content(model=MODEL, contents=prompt).text.strip()
            return {"text": text, "source": "gemini", "unverified_numbers": unverified_numbers(text, ctx)}
        except Exception:
            logging.exception("Gemini proposal failed, using template")
    return {"text": _template(ctx), "source": "template", "unverified_numbers": []}
