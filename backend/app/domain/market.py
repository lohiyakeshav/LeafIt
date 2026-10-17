"""Bill of materials, vendors and quote links (PRD §10). Pure logic: vendors come from integrations/vendors (Places), plans from app/repositories."""
import math
from urllib.parse import quote

from app.domain import species as species_mod
from app.domain.sim import Block

BOM_ITEMS = {  # intervention -> (category, item, unit)
    "tree": ("nursery", "Native saplings (2–3 m), planting and 3 years of care", "tree"),
    "cool_roof": ("roofing", "Solar-reflective roof coating", "m²"),
    "shade_stop": ("shade", "Shaded bus-stop structure", "unit"),
}


def bom(block: Block, placements: list[dict]) -> list[dict]:
    """What to buy: one nursery line per tree species (the generic tree keeps the plain wording), then roofs and shelters."""
    qty = {t: 0.0 for t in BOM_ITEMS if t != "tree"}
    trees: dict[str, int] = {}
    for p in placements:
        t = p["type"]
        if t == "tree":
            sp = species_mod.get(p.get("species"))["id"]
            trees[sp] = trees.get(sp, 0) + p.get("count", 1)
        else:
            qty[t] += block.roof_area[p["row"], p["col"]] if t == "cool_roof" else p.get("count", 1)
    plural = lambda u, q: u if u == "m²" or round(q) == 1 else u + "s"
    items = []
    for sp_id, n in sorted(trees.items(), key=lambda kv: -kv[1]):
        sp = species_mod.get(sp_id)
        name = BOM_ITEMS["tree"][1] if sp_id == species_mod.DEFAULT else f"{sp['common']} ({sp['scientific']}) saplings (2–3 m), planting and 3 years of care"
        items.append({"type": "tree", "category": "nursery", "item": name, "quantity": n, "unit": plural("tree", n), "species": sp_id})
    items += [{"type": t, "category": BOM_ITEMS[t][0], "item": BOM_ITEMS[t][1], "quantity": round(q), "unit": plural(BOM_ITEMS[t][2], q)}
              for t, q in qty.items() if q]
    return items


def center(block: Block) -> tuple[float, float]:
    m = block.meta
    lat = m["origin"]["lat"] - m["rows"] * m["cell_m"] / 2 / 111_320
    lng = m["origin"]["lng"] + m["cols"] * m["cell_m"] / 2 / (111_320 * math.cos(math.radians(lat)))
    return lat, lng


def km(a, b) -> float:
    (la1, lo1), (la2, lo2) = [(math.radians(x), math.radians(y)) for x, y in (a, b)]
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


SEARCH_RADIUS_KM = 25
NEAREST_FALLBACK = 3  # per category, when nothing is inside the radius


def find_vendors(vendors: list[dict], near: tuple[float, float], categories: set[str] | None,
                 radius_km: float = SEARCH_RADIUS_KM) -> list[dict]:
    """Vendors within `radius_km` (straight line from the area's centre). A category with nobody inside the radius
    still gets its nearest few, flagged `beyond_radius`, so the user learns how far the closest supplier is."""
    out = [{**v, "distance_km": round(km(near, (v["lat"], v["lng"])), 1), "beyond_radius": False} for v in vendors
           if not categories or v["category"] in categories]
    inside = [v for v in out if v["distance_km"] <= radius_km]
    for cat in {v["category"] for v in out} - {v["category"] for v in inside}:
        far = sorted((v for v in out if v["category"] == cat), key=lambda v: v["distance_km"])[:NEAREST_FALLBACK]
        inside += [{**v, "beyond_radius": True} for v in far]
    return sorted(inside, key=lambda v: (v["beyond_radius"], v["distance_km"] - (v.get("rating") or 0)))  # naive rank: 1★ ≈ 1 km


def quote_links(plan: dict, block: Block, items: list[dict], vendor: dict) -> dict:
    lines = [f"Hello {vendor['name']},", f"LeafIt quote request for {block.meta['name']} (plan {plan['id']}):"]
    lines += [f"• {i['item']}: {i['quantity']:,} {i['unit']}" for i in items if i["category"] == vendor["category"]]
    lines.append("Please share your quote and earliest start date. Thank you.")
    text = "\n".join(lines)
    phone = (vendor.get("phone") or "").lstrip("+")  # no number -> WhatsApp lets the user pick a chat
    return {
        "message": text,
        "whatsapp_url": f"https://wa.me/{phone}?text={quote(text)}",
        "tel_url": f"tel:+{phone}" if phone else None,
        "website": vendor.get("website"), "maps_url": vendor.get("maps_url"),
    }
