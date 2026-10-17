"""Vendors (search radius and nearest-beyond fallback) and money in the reader's currency."""
from app.agents.proposal import money, with_money
from app.api.deps import vendor_repository
from app.domain import market


def test_nothing_in_radius_returns_the_nearest_few_flagged():
    far = market.find_vendors(vendor_repository.list_vendors(), (19.07, 72.87), {"nursery"}, 25)   # Mumbai: every sample nursery is in Delhi
    assert far and all(v["beyond_radius"] for v in far) and len(far) <= market.NEAREST_FALLBACK
    assert far[0]["distance_km"] > 25


def test_vendors_inside_radius_are_not_flagged(block):
    near = market.find_vendors(vendor_repository.list_vendors(), market.center(block), {"nursery"}, 25)
    assert near and not any(v["beyond_radius"] for v in near)


def test_proposal_money_is_converted_and_preformatted():
    assert money(4500, None) == "₹4,500"
    assert money(4500, {"code": "USD", "rate": 0.0105}) == "$47.25"
    assert money(50, {"code": "USD", "rate": 0.0105}) == "$0.53"                 # small amounts keep cents
    ctx = with_money({"metrics": {"total_cost_inr": 4500, "cost_per_degree_inr": None}, "currency": {"code": "JPY", "rate": 1.66}})
    assert ctx["money"]["total_cost"] == "¥7,470" and ctx["money"]["cost_per_degree_c"] is None
