"""Vendors (real Places results, search radius and nearest-beyond fallback) and money in the reader's currency."""
from app.agents.proposal import money, with_money
from app.domain import market
from app.integrations import vendors as vendor_search

# Places-shaped vendors near Lajpat Nagar (what integrations/vendors.search returns); tests never call Google
NURSERIES = [
    {"id": "nursery:a", "name": "Near nursery", "category": "nursery", "lat": 28.57, "lng": 77.24, "rating": 4.2, "phone": "919800000000"},
    {"id": "nursery:b", "name": "Unrated nursery", "category": "nursery", "lat": 28.50, "lng": 77.30, "rating": None, "phone": None},
]


def test_nothing_in_radius_returns_the_nearest_few_flagged():
    far = market.find_vendors(NURSERIES, (19.07, 72.87), {"nursery"}, 25)   # from Mumbai, both Delhi nurseries are far
    assert far and all(v["beyond_radius"] for v in far) and len(far) <= market.NEAREST_FALLBACK
    assert far[0]["distance_km"] > 25


def test_vendors_inside_radius_are_not_flagged_and_unrated_ones_still_rank(block):
    near = market.find_vendors(NURSERIES, market.center(block), {"nursery"}, 25)
    assert [v["id"] for v in near] == ["nursery:a", "nursery:b"] and not any(v["beyond_radius"] for v in near)


def test_places_results_become_vendors_and_closed_businesses_are_dropped():
    open_place = {"id": "ChIJx", "displayName": {"text": "Green Nursery"}, "formattedAddress": "Lajpat Nagar, New Delhi",
                  "location": {"latitude": 28.56, "longitude": 77.24}, "rating": 4.4, "userRatingCount": 120,
                  "internationalPhoneNumber": "+91 98100 12345", "googleMapsUri": "https://maps.google.com/?cid=1"}
    v = vendor_search._vendor(open_place, "nursery")
    assert v["id"] == "nursery:ChIJx" and v["phone"] == "919810012345" and v["source"] == "google_places" and v["rating"] == 4.4
    assert vendor_search._vendor({**open_place, "businessStatus": "CLOSED_PERMANENTLY"}, "nursery") is None


def test_without_a_server_key_there_are_no_vendors_rather_than_made_up_ones(api):
    assert vendor_search.available() is False and vendor_search.search("nursery", 28.57, 77.24) == []
    assert api.get("/vendors", params={"block_id": "lajpat_nagar"}).json() == {"available": False, "vendors": []}


def test_proposal_money_is_converted_and_preformatted():
    assert money(4500, None) == "₹4,500"
    assert money(4500, {"code": "USD", "rate": 0.0105}) == "$47.25"
    assert money(50, {"code": "USD", "rate": 0.0105}) == "$0.53"                 # small amounts keep cents
    ctx = with_money({"metrics": {"total_cost_inr": 4500, "cost_per_degree_inr": None}, "currency": {"code": "JPY", "rate": 1.66}})
    assert ctx["money"]["total_cost"] == "¥7,470" and ctx["money"]["cost_per_degree_c"] is None


def test_the_bill_of_materials_has_one_nursery_line_per_species(block):
    plan = [{"type": "tree", "row": 5, "col": 5, "count": 2, "species": "neem"}, {"type": "tree", "row": 5, "col": 6, "species": "neem"},
            {"type": "tree", "row": 5, "col": 7, "count": 2, "species": "peepal"}, {"type": "tree", "row": 5, "col": 8}]
    trees = [i for i in market.bom(block, plan) if i["type"] == "tree"]
    assert [(i["species"], i["quantity"]) for i in trees] == [("neem", 3), ("peepal", 2), ("generic", 1)]
    assert "Neem (Azadirachta indica)" in trees[0]["item"] and trees[2]["item"].startswith("Native saplings") and trees[2]["unit"] == "tree"
    assert all(i["category"] == "nursery" for i in trees)
