"""HTTP API: status codes, readable validation messages, and the plan → bill of materials → vendors → quote flow."""
import pytest


def test_blocks_and_simulate(api, cells):
    assert api.get("/blocks").json()[0]["id"] == "lajpat_nagar"
    assert api.get("/blocks/lajpat_nagar").json()["rows"] == 70
    res = api.post("/simulate", json={"block_id": "lajpat_nagar", "placements": cells.trees(5)})
    assert res.status_code == 200 and len(res.json()["cooling_grid"]) == 70
    assert api.post("/simulate", json={"block_id": "lajpat_nagar", "placements": [{"type": "tree", "row": 999, "col": 0}]}).status_code == 422
    assert api.post("/simulate", json={"block_id": "nope", "placements": []}).status_code == 404
    assert api.get("/assumptions").json()


@pytest.mark.parametrize("path, body, message", [
    ("/agent", {"block_id": "lajpat_nagar", "brief": "x", "budget_inr": 1e28}, "Budget can be at most ₹100 crore."),
    ("/agent", {"block_id": "lajpat_nagar", "brief": "x", "budget_inr": 500}, "Budget must be at least ₹10,000."),
    ("/agent", {"block_id": "lajpat_nagar", "brief": "x", "budget_inr": "lots"}, "Budget must be a number."),
    ("/agent", {"block_id": "lajpat_nagar", "brief": "x" * 501, "budget_inr": 1e6}, "Your brief is too long (max 500 characters)."),
    ("/agent", {"block_id": "lajpat_nagar", "brief": "x"}, "Budget is required."),
    ("/simulate", {"block_id": "lajpat_nagar", "placements": [{"type": "tree", "row": 1, "col": 1}] * 5001}, "The plan has too many items (max 5,000)."),
    ("/plans", {"block_id": "lajpat_nagar", "placements": [], "name": "n" * 81}, "Plan name is too long (max 80 characters)."),
])
def test_validation_errors_are_one_readable_sentence(api, path, body, message):
    r = api.post(path, json=body)
    assert r.status_code == 422 and r.json()["detail"] == message


def test_user_prices_over_http_and_in_saved_plans(api, cells):
    r, c = map(int, cells.open[0])
    pl = [{"type": "tree", "row": r, "col": c, "count": 2}]
    assert api.post("/simulate", json={"block_id": "lajpat_nagar", "placements": pl, "unit_cost": {"tree": 1500}}).json()["metrics"]["total_cost_inr"] == 3000
    assert api.post("/simulate", json={"block_id": "lajpat_nagar", "placements": pl, "unit_cost": {"tree": -5}}).status_code == 422
    pid = api.post("/plans", json={"block_id": "lajpat_nagar", "placements": pl, "unit_cost": {"tree": 1500}}).json()["id"]
    assert api.get(f"/plans/{pid}").json()["metrics"]["total_cost_inr"] == 3000       # the plan remembers its prices


def test_plan_bom_vendors_quote_proposal(api, cells, monkeypatch):
    mix = cells.mix()
    pid = api.post("/plans", json={"block_id": "lajpat_nagar", "placements": mix, "name": "   "}).json()["id"]
    plan = api.get(f"/plans/{pid}").json()
    assert plan["name"] == "Untitled plan" and plan["metrics"]["total_cost_inr"] == cells.metrics(mix)["total_cost_inr"]
    bom = {i["type"]: i for i in api.get(f"/plans/{pid}/bom").json()}
    assert bom["tree"]["quantity"] == 3 and bom["shade_stop"]["quantity"] == 1
    from app.integrations import vendors as vendor_search
    from tests.test_market import NURSERIES
    monkeypatch.setattr(vendor_search, "available", lambda: True)
    monkeypatch.setattr(vendor_search, "search", lambda cat, lat, lng: [v for v in NURSERIES if v["category"] == cat])
    monkeypatch.setattr(vendor_search, "get", lambda vid: next((v for v in NURSERIES if v["id"] == vid), None))
    got = api.get("/vendors", params={"block_id": "lajpat_nagar", "category": "nursery"}).json()
    vs = got["vendors"]
    assert got["available"] and vs and all(v["category"] == "nursery" for v in vs)
    q = api.post("/quotes", json={"plan_id": pid, "vendor_id": vs[0]["id"]}).json()
    assert "3 trees" in q["message"] and "m²" not in q["message"] and q["message"].startswith("Hello Near nursery,")
    assert q["whatsapp_url"].startswith("https://wa.me/919800000000?text=") and q["tel_url"] == "tel:+919800000000"
    assert api.post("/quotes", json={"plan_id": pid, "vendor_id": "nursery:nope"}).status_code == 404
    prop = api.post(f"/plans/{pid}/proposal").json()
    assert prop["source"] == "template" and "Bill" not in prop["text"] and "₹" in prop["text"]


def test_plan_ids_cannot_escape_the_store(api):
    from app.api.deps import plan_repository
    assert plan_repository.get_plan("../etc") is None and plan_repository.get_plan("..%2Fetc") is None
    assert api.get("/plans/nope").status_code == 404
    # over HTTP "/plans/../etc" normalises to "/etc": whatever answers (the web app, or a plain 404 without it), it is never a plan
    r = api.get("/plans/../etc")
    assert r.status_code in (200, 404) and "placements" not in r.text


def test_old_plans_and_areas_expire(api, tmp_path):
    import os
    import time

    from app import config
    from app.api.deps import block_repository, plan_repository, purge_expired
    pid = api.post("/plans", json={"block_id": "lajpat_nagar", "placements": []}).json()["id"]
    fresh = api.post("/plans", json={"block_id": "lajpat_nagar", "placements": []}).json()["id"]
    block_repository.areas_dir.mkdir(parents=True, exist_ok=True)
    old_area = block_repository.areas_dir / "a_000000000000.json"
    old_area.write_text("{}")
    long_ago = time.time() - (max(config.PLAN_TTL_DAYS, config.AREA_TTL_DAYS) + 1) * 86_400
    for f in (plan_repository.plans_dir / f"{pid}.json", old_area):
        os.utime(f, (long_ago, long_ago))
    assert purge_expired() == 2
    assert api.get(f"/plans/{pid}").status_code == 404 and api.get(f"/plans/{fresh}").status_code == 200
    assert not old_area.exists() and block_repository.get_block("lajpat_nagar")      # shipped sample blocks are never touched


def test_species_survive_the_api_into_saved_plans_and_the_bill_of_materials(api, cells):
    r, c = map(int, cells.open[0])
    pl = [{"type": "tree", "row": r, "col": c, "count": 1, "species": "neem"}]
    sim = api.post("/simulate", json={"block_id": "lajpat_nagar", "placements": pl}).json()
    assert sim["breakdown"]["trees_by_species"] == {"neem": 1}                       # the server simulated a neem, not the generic tree
    pid = api.post("/plans", json={"block_id": "lajpat_nagar", "placements": pl}).json()["id"]
    assert api.get(f"/plans/{pid}").json()["placements"][0]["species"] == "neem"
    assert any("Neem" in i["item"] for i in api.get(f"/plans/{pid}/bom").json())
    bad = api.post("/simulate", json={"block_id": "lajpat_nagar", "placements": [{**pl[0], "species": "unicorn"}]})
    assert bad.status_code == 422
