"""Bill of materials, vendors and quote links (PRD §10). Pure logic: persistence lives in app/store.py."""
import json
import math
from pathlib import Path
from urllib.parse import quote

from .sim import Block

VENDORS = json.loads((Path(__file__).parents[2] / "data/vendors.json").read_text())

BOM_ITEMS = {  # intervention -> (category, item, unit)
    "tree": ("nursery", "Native saplings (2–3 m), planting and 3 years of care", "tree"),
    "cool_roof": ("roofing", "Solar-reflective roof coating", "m²"),
    "shade_stop": ("shade", "Shaded bus-stop structure", "unit"),
}


def bom(block: Block, placements: list[dict]) -> list[dict]:
    qty = {t: 0.0 for t in BOM_ITEMS}
    for p in placements:
        t = p["type"]
        qty[t] += block.roof_area[p["row"], p["col"]] if t == "cool_roof" else p.get("count", 1)
    plural = lambda u, q: u if u == "m²" or round(q) == 1 else u + "s"
    return [{"type": t, "category": BOM_ITEMS[t][0], "item": BOM_ITEMS[t][1], "quantity": round(q),
             "unit": plural(BOM_ITEMS[t][2], q)} for t, q in qty.items() if q]


def center(block: Block) -> tuple[float, float]:
    m = block.meta
    lat = m["origin"]["lat"] - m["rows"] * m["cell_m"] / 2 / 111_320
    lng = m["origin"]["lng"] + m["cols"] * m["cell_m"] / 2 / (111_320 * math.cos(math.radians(lat)))
    return lat, lng


def km(a, b) -> float:
    (la1, lo1), (la2, lo2) = [(math.radians(x), math.radians(y)) for x, y in (a, b)]
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def find_vendors(near: tuple[float, float], categories: set[str] | None, radius_km: float) -> list[dict]:
    out = [{**v, "distance_km": round(km(near, (v["lat"], v["lng"])), 1)} for v in VENDORS
           if not categories or v["category"] in categories]
    out = [v for v in out if v["distance_km"] <= radius_km]
    return sorted(out, key=lambda v: (v["distance_km"] - v["rating"]))  # ponytail: naive rank, 1★ ≈ 1 km


def quote_links(plan: dict, block: Block, items: list[dict], vendor: dict) -> dict:
    lines = [f"Hello {vendor['name']},", f"LeafIt quote request for {block.meta['name']} (plan {plan['id']}):"]
    lines += [f"• {i['item']}: {i['quantity']:,} {i['unit']}" for i in items if i["category"] == vendor["category"]]
    lines.append("Please share your quote and earliest start date. Thank you.")
    text = "\n".join(lines)
    phone = (vendor.get("phone") or "").lstrip("+")  # no number -> WhatsApp lets the user pick a chat
    return {
        "message": text,
        "whatsapp_url": f"https://wa.me/{phone}?text={quote(text)}",
        "mailto_url": f"mailto:{vendor.get('email', '')}?subject={quote('LeafIt quote request ' + plan['id'])}&body={quote(text)}",
    }
