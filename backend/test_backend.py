"""Run: .venv/bin/python test_backend.py  (from backend/)"""
import os
import tempfile
import time
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from app.domain import market
from app.domain.optimise import optimise
from app.domain.sim import ASSUMPTIONS, maturity, simulate
from app.main import app
from app.store import store

block = store.get_block("demo_lajpat")
open_cells = np.argwhere(block.building_frac < 0.5)
roofs = np.argwhere(block.roof_area > 0)
road = next((r, c) for r, c in open_cells if block.is_class(r, c, "road"))


def trees(n):
    return [{"type": "tree", "row": int(r), "col": int(c)} for r, c in open_cells[:n]]


def m(placements, **kw):
    return simulate(block, placements, **kw)["metrics"]


# nothing placed -> nothing changes
base = m([])
assert base["temp_reduction_c"] == 0 and base["total_cost_inr"] == 0 and base["cost_per_degree_inr"] is None

# more trees cool more, but with diminishing returns when stacked in one cell
assert m(trees(200))["temp_reduction_c"] > m(trees(50))["temp_reduction_c"] > 0
one = {"type": "tree", "row": int(open_cells[0][0]), "col": int(open_cells[0][1])}
peak = lambda n: m([{**one, "count": n}])["peak_reduction_c"]
assert peak(10) < 10 * peak(1)

# assumptions stay inside what the sources support
assert abs(maturity(10) - 0.57) < 0.01 and abs(maturity(5) - 0.34) < 0.01 and maturity(30) < 1
full = simulate(block, trees(1000), years=30)
assert -0.5 < full["metrics"]["aqi_change"] < 0  # trees barely move AQI (Nowak 2013: <=0.24% citywide)
assert full["breakdown"]["aq_gain_pct"] <= 0.24
assert all(a["status"] in {"cited", "derived", "estimate", "modelling choice", "under review"} for a in ASSUMPTIONS)
assert all(a["sources"] for a in ASSUMPTIONS if a["status"] in {"cited", "derived", "estimate"})  # numbers need a source

# a cool roof cools its own roof surface a lot, the street only a little
roof_only = simulate(block, [{"type": "cool_roof", "row": int(roofs[0][0]), "col": int(roofs[0][1])}])
assert roof_only["metrics"]["roof_surface_reduction_c"] > 5 > 0.5 > roof_only["metrics"]["temp_reduction_c"]
assert max(map(max, roof_only["cooling_grid"])) > 5  # the map shows the roof turning cool

# trees grow: year 1 < year 10
assert m(trees(100), years=1)["co2_captured_kg_per_year"] < m(trees(100))["co2_captured_kg_per_year"]

# costs add up
r, c = map(int, roofs[0])
mix = trees(3) + [{"type": "cool_roof", "row": r, "col": c}, {"type": "shade_stop", "row": int(road[0]), "col": int(road[1])}]
assert m(mix)["total_cost_inr"] == round(3 * 3000 + block.roof_area[r, c] * 250 + 1_000_000)
bd = simulate(block, mix)["breakdown"]  # the "how is this calculated" numbers add up to the metrics
assert bd["trees"] == 3 and bd["stops"] == 1 and sum(bd["cost_parts"].values()) == m(mix)["total_cost_inr"]
assert m(mix)["co2_captured_kg_per_year"] == round(bd["trees"] * bd["tree_co2_kg"] * bd["maturity"])

# a bus stop cuts exposure without cooling the air
stop = m([mix[-1]])
assert stop["temp_reduction_c"] == 0 and stop["heat_exposure_reduction_pct"] >= 0

# invalid placements are rejected
for bad in ({"type": "tree", "row": -1, "col": 0}, {"type": "cool_roof", "row": int(road[0]), "col": int(road[1])},
            {"type": "tree", "row": int(roofs[0][0]), "col": int(roofs[0][1])}):
    try:
        simulate(block, [bad])
        raise AssertionError(f"accepted {bad}")
    except ValueError:
        pass

# PRD: < 500 ms for a block-sized grid
t = time.perf_counter()
m(trees(1000))
assert time.perf_counter() - t < 0.5

# API
api = TestClient(app)
assert api.get("/blocks").json()[0]["id"] == "demo_lajpat"
assert api.get("/blocks/demo_lajpat").json()["rows"] == 60
res = api.post("/simulate", json={"block_id": "demo_lajpat", "placements": trees(5)})
assert res.status_code == 200 and len(res.json()["cooling_grid"]) == 60
assert api.post("/simulate", json={"block_id": "demo_lajpat", "placements": [{"type": "tree", "row": 999, "col": 0}]}).status_code == 422
assert api.post("/simulate", json={"block_id": "nope", "placements": []}).status_code == 404

# validation errors come back as one readable sentence, never Pydantic internals
def detail(path, body):
    r = api.post(path, json=body)
    assert r.status_code == 422, r.status_code
    return r.json()["detail"]
agent_body = {"block_id": "demo_lajpat", "brief": "x"}
assert detail("/agent", {**agent_body, "budget_inr": 1e28}) == "Budget can be at most ₹100 crore."
assert detail("/agent", {**agent_body, "budget_inr": 500}) == "Budget must be at least ₹10,000."
assert detail("/agent", {**agent_body, "budget_inr": "lots"}) == "Budget must be a number."
assert detail("/agent", {"block_id": "demo_lajpat", "brief": "x" * 501, "budget_inr": 1e6}) == "Your brief is too long (max 500 characters)."
assert detail("/agent", {"block_id": "demo_lajpat", "brief": "x"}) == "Budget is required."
assert detail("/simulate", {"block_id": "demo_lajpat", "placements": [{"type": "tree", "row": 1, "col": 1}] * 5001}) == "The plan has too many items (max 5,000)."
assert detail("/plans", {"block_id": "demo_lajpat", "placements": [], "name": "n" * 81}) == "Plan name is too long (max 80 characters)."


# optimiser: stays in budget; greedy beats naive "first N open cells" for the same money; focus moves the plan
for k in ("GEMINI_API_KEY", "GOOGLE_CLOUD_PROJECT"):
    os.environ.pop(k, None)
avg = optimise(block, 1_500_000)
assert 0 < m(avg)["total_cost_inr"] <= 1_500_000
assert m(avg)["temp_reduction_c"] > m(trees(500))["temp_reduction_c"]
school = next(l for l in block.meta["landmarks"] if l["kind"] == "school")
dist = lambda plan: np.mean([abs(p["row"] - school["row"]) + abs(p["col"] - school["col"]) for p in plan])
assert dist(optimise(block, 300_000, "hotspots", focus=[(school["row"], school["col"])])) < dist(optimise(block, 300_000, "hotspots"))

# /agent offline: keyword rules pick the landmark scenario and leave roofs alone when asked
t = time.perf_counter()
rec = api.post("/agent", json={"block_id": "demo_lajpat", "budget_inr": 1_500_000,
                               "brief": "Keep children walking to the school cool, avoid roofs"}).json()
rec_s = time.perf_counter() - t
assert rec["source"] == "rules" and rec["explanation"].startswith("- ")
assert rec["chosen"] == rec["scenarios"][-1]["id"] and "Government school" in rec["scenarios"][-1]["label"]
assert all(p["type"] == "tree" for p in rec["placements"]) and rec["metrics"]["total_cost_inr"] <= 1_500_000
assert len(rec["steps"]) == 5  # overview, 3 scenarios, choice
near = lambda sc: sc["metrics"]["landmark_cooling_c"]["Government school"]
assert near(rec["scenarios"][-1]) > near(rec["scenarios"][0])  # focusing actually cools the school more
assert "Around the Government school" in rec["explanation"]

# /agent with Gemini: a scripted fake built from real SDK types drives the tool loop
from google.genai import types as gt
from app.agents import agent


def reply(*parts):
    return gt.GenerateContentResponse(candidates=[gt.Candidate(content=gt.Content(role="model", parts=list(parts)))])


call = lambda name, **args: gt.Part(function_call=gt.FunctionCall(name=name, args=args))


class FakeLLM:
    def __init__(self, script):
        self.script, self.seen = script, []
        self.models = self

    def generate_content(self, model, contents, config=None):
        self.seen.append(contents[-1])
        return self.script.pop(0)(self) if callable(self.script[0]) else self.script.pop(0)


def final(llm):  # quotes a real tool number and one invented number
    s2 = llm.seen[-2].parts[1].function_response.response["result"]
    return reply(gt.Part(text=f"- S2 cools the school area by {s2['peak_reduction_c']} °C.\n- It also saves 987654 rupees."))


fake = FakeLLM([
    reply(call("get_block_overview")),
    reply(call("run_scenario", label="Average", goal="average", interventions=["tree", "cool_roof"]),
          call("run_scenario", label="School", goal="hotspots", interventions=["tree"],
               focus_landmarks=["Government school"], budget_inr=9e9)),
    reply(call("choose_scenario", scenario_id="S2", reason="brief is about the school")),
    final,
])
out = agent.plan(block, "school kids", 1_000_000, llm=fake)
assert out["source"] == "gemini" and out["chosen"] == "S2" and [s["label"] for s in out["scenarios"]] == ["Average", "School"]
assert out["metrics"]["total_cost_inr"] <= 1_000_000  # budget_inr=9e9 from the model was capped
assert out["unverified_numbers"] == [987654.0]  # guardrail catches the invented figure, accepts the real one
assert any(s["action"].startswith("Chose S2") for s in out["steps"])

# a broken model falls back to rules instead of failing the request
assert agent.plan(block, "hot streets", 500_000, llm=FakeLLM([])).get("source") == "rules"

# photo analysis needs Gemini -> clear 503 offline; bad base64 -> 422
assert api.post("/photo", json={"image_b64": "aGVsbG8="}).status_code == 503
assert api.post("/photo", json={"image_b64": "not base64!"}).status_code == 422

# plans -> bom -> vendors -> quote links
store.plans_dir = Path(tempfile.mkdtemp())
pid = api.post("/plans", json={"block_id": "demo_lajpat", "placements": mix, "name": "   "}).json()["id"]
assert api.get(f"/plans/{pid}").json()["name"] == "Untitled plan"  # blank name -> default
assert api.get(f"/plans/{pid}").json()["metrics"]["total_cost_inr"] == m(mix)["total_cost_inr"]
bom = {i["type"]: i for i in api.get(f"/plans/{pid}/bom").json()}
assert bom["tree"]["quantity"] == 3 and bom["shade_stop"]["quantity"] == 1
assert api.get("/plans/../etc").status_code == 404 and api.get("/plans/nope").status_code == 404
vs = api.get("/vendors", params={"block_id": "demo_lajpat", "category": "nursery"}).json()
assert vs and all(v["category"] == "nursery" for v in vs)
q = api.post("/quotes", json={"plan_id": pid, "vendor_id": vs[0]["id"]}).json()
assert "3 trees" in q["message"] and "m²" not in q["message"] and q["whatsapp_url"].startswith("https://wa.me/?text=")
assert api.get("/assumptions").json()
prop = api.post(f"/plans/{pid}/proposal").json()
assert prop["source"] == "template" and "Bill" not in prop["text"] and "₹" in prop["text"]

print(f"all checks passed; /agent {rec_s:.2f}s;", "1000 trees:", m(trees(1000)))
print(rec["explanation"]); print(prop["text"][:300])

# golden fixtures: the same cases the browser simulator must reproduce (shared/fixtures/golden.json)
import json
golden = json.loads((Path(__file__).parents[1] / "shared/fixtures/golden.json").read_text())
for case in golden["cases"]:
    got = simulate(block, case["placements"], case["years"])
    assert got["metrics"] == case["expected"]["metrics"], case["name"]
    assert round(float(np.array(got["cooling_grid"]).sum()), 2) == case["expected"]["cooling_sum"], case["name"]
print(f"golden fixtures: {len(golden['cases'])} cases match")

# ---- areas: size limits, grid maths, footprints, and the whole build pipeline with Earth Engine faked --------------
import asyncio
from app.geodata import area_builder, conditions, earthengine, places
from app.geodata.buildings import coverage, parse_features
from app.geodata.grid import Bounds, area_id, classify, make_grid, validate


def box(lat, lng, w_m, h_m):
    dlat, dlng = h_m / 111_320, w_m / (111_320 * np.cos(np.radians(lat)))
    return Bounds(lat + dlat / 2, lat - dlat / 2, lng + dlng / 2, lng - dlng / 2)


def rejects(b, word):
    try:
        validate(b)
        raise AssertionError("accepted")
    except ValueError as e:
        assert word in str(e), e


validate(box(28.57, 77.24, 700, 700))                       # 0.49 km² fine
validate(box(28.57, 77.24, 1000, 1000))                     # right at the 1 km² cap
rejects(box(28.57, 77.24, 150, 700), "too small")
rejects(box(28.57, 77.24, 1200, 1200), "too large")         # 1.44 km²
rejects(box(28.57, 77.24, 1600, 200), "too large")          # side over 1500 m
rejects(Bounds(1, 2, 3, 4), "not valid")
assert area_id(box(28.57, 77.24, 700, 700)) == area_id(box(28.57, 77.24, 700, 700)) != area_id(box(28.58, 77.24, 700, 700))

b = box(28.57, 77.24, 700, 500)
g = make_grid(b)
assert (g.rows, g.cols) == (50, 70) and g.cell_of(g.north - 1e-9, g.west + 1e-9) == (0, 0) and g.cell_of(g.south - 0.01, g.west) is None
lat, lng = g.north - 25.5 * g.dlat, g.west + 40.5 * g.dlng  # cell centre: boundaries would be at the mercy of float rounding
assert g.cell_of(lat, lng) == (25, 40) and all(abs(v - e) < 1e-6 for v, e in zip(g.to_local_m(lat, lng), (405, 255)))

sq = lambda x, z, s: {"id": f"s{x}{z}", "area_m2": s * s, "height_m": 9.0, "poly": [[x, z], [x + s, z], [x + s, z + s], [x, z + s]]}
cov = coverage([sq(20, 20, 20), sq(0, 0, 5), sq(20, 20, 10)], g)   # a 20 m square covers four whole cells; a 5 m one a quarter; overlaps count once
assert cov[2:4, 2:4].min() == 1 and cov[0, 0] == 0.25 and abs(cov.sum() - 4.25) < 1e-6
tri = coverage([{"poly": [[13.3, 13.3], [37.7, 13.3], [25, 41.1]]}], g)  # unbiased on awkward shapes: true area 339.2 m²
assert abs(tri.sum() * 100 - 339.2) < 14  # ~4%: point-sampling noise on a small shape; mean bias over random shapes is -1%
cls = classify(np.array([[50, 50, 10, 80, 30]]), np.array([[0.0, 0.9, 0.0, 0.0, 0.0]]))
assert cls.tolist() == [[1, 0, 2, 5, 3]]                    # bare built-up -> road, covered built-up -> built, tree, water, grass

nan_lst = np.full((20, 20), 40.0); nan_lst[5:9, 5:9] = np.nan
assert np.isfinite(earthengine.fill_gaps(nan_lst)).all() and abs(earthengine.fill_gaps(nan_lst)[6, 6] - 40) < 0.01
try:
    earthengine.fill_gaps(np.full((5, 5), np.nan)); raise AssertionError
except earthengine.EEUnavailable:
    pass
assert earthengine.hot_months(28.6) == (4, 6) and earthengine.hot_months(-33) == (12, 2)

lms = places.pick([{"displayName": {"text": "A"}, "types": ["school"], "location": {"latitude": lat, "longitude": lng}},
                   {"displayName": {"text": "Far"}, "types": ["school"], "location": {"latitude": 0, "longitude": 0}},
                   {"displayName": {"text": "P"}, "types": ["park"], "location": {"latitude": lat, "longitude": lng}}], g)
assert [(x["name"], x["kind"], x["row"], x["col"]) for x in lms] == [("A", "school", 25, 40), ("P", "park", 25, 40)]


# a fake Earth Engine response goes through the REAL assembler, then the real simulator
def fake_layers(bounds, grid):
    feats = [{"properties": {"full_plus_code": f"X{i}"}, "geometry": {"type": "Polygon", "coordinates": [[
        [grid.west + (4 + 3 * i) * grid.dlng, grid.north - 10 * grid.dlat], [grid.west + (6 + 3 * i) * grid.dlng, grid.north - 10 * grid.dlat],
        [grid.west + (6 + 3 * i) * grid.dlng, grid.north - 12 * grid.dlat], [grid.west + (4 + 3 * i) * grid.dlng, grid.north - 12 * grid.dlat],
        [grid.west + (4 + 3 * i) * grid.dlng, grid.north - 10 * grid.dlat]]]}} for i in range(5)]
    return {"lst": np.full((grid.rows, grid.cols), 44.0), "worldcover": np.full((grid.rows, grid.cols), 50), "features": feats,
            "height_at": lambda la, ln: 12.0, "lst_period": "test"}


async def fake_conditions(la, ln):
    return {"air_temp_c": 38.0, "feels_like_c": 41.0, "humidity_pct": 30, "aqi": 212, "aqi_source": "test", "fetched_at": 0}

earthengine.fetch_layers = fake_layers
conditions.fetch = fake_conditions
area = asyncio.run(area_builder.build_area(box(28.57, 77.24, 600, 400), "Test area"))
assert area["synthetic"] is False and area["source"] == "earth_engine" and area["baseline_aqi"] == 212 and len(area["buildings"]) == 5
assert (area["rows"], area["cols"]) == (40, 60) and len(area["lst_c"]) == 40 and area["buildings"][0]["height_m"] == 12.0
assert area["buildings"][0]["poly"][0] == [40.0, 100.0] or abs(area["buildings"][0]["poly"][0][0] - 40) < 0.2
assert max(map(max, area["building_frac"])) == 1.0 and area["landcover"][10][4] == 0 and area["landcover"][0][0] == 1  # roof / road

store.areas_dir = Path(tempfile.mkdtemp())
store.put_area(area)
ablock = store.get_block(area["id"])
sim_out = simulate(ablock, [{"type": "tree", "row": 0, "col": 0}, {"type": "cool_roof", "row": 10, "col": 4}], 10)
assert sim_out["metrics"]["total_cost_inr"] == 3000 + round(float(ablock.roof_area[10, 4]) * 250) and len(sim_out["cooling_grid"]) == 40

# API: out-of-range -> readable 422; Earth Engine down -> 503 unless the dev flag is set; built areas are cached and immutable
good = {"bounds": {"north": b.north, "south": b.south, "east": b.east, "west": b.west}, "name": "Lajpat"}
earthengine.fetch_layers = fake_layers
r = api.post("/areas", json=good).json()
assert r["cached"] is False and api.post("/areas", json=good).json() == {"id": r["id"], "cached": True}
got = api.get(f"/areas/{r['id']}")
assert got.json()["kind"] == "area" and "immutable" in got.headers["cache-control"] and api.get("/areas/nope").status_code == 404
assert api.get(f"/blocks/{r['id']}").status_code == 200 and r["id"] not in [x["id"] for x in api.get("/blocks").json()]
assert api.post("/simulate", json={"block_id": r["id"], "placements": [{"type": "tree", "row": 3, "col": 3}]}).status_code == 200

big = {"bounds": {"north": 28.6, "south": 28.5, "east": 77.3, "west": 77.2}}
assert "too large" in api.post("/areas", json=big).json()["detail"]
assert api.post("/areas", json={"bounds": {"north": 99, "south": 0, "east": 1, "west": 0}}).json()["detail"] == "The area's corners must be real map coordinates."

def down(bounds, grid):
    raise earthengine.EEUnavailable("The satellite data service isn't reachable right now.")
earthengine.fetch_layers = down
other = {"bounds": {k: v + 0.01 for k, v in good["bounds"].items()}}
assert api.post("/areas", json=other).status_code == 503
from app import config
config.ALLOW_SYNTHETIC_AREAS = True
syn = api.post("/areas", json=other).json()
sb = api.get(f"/areas/{syn['id']}").json()
assert sb["synthetic"] is True and sb["source"] == "synthetic" and "synthetic" in sb["name"] and len(sb["lst_c"]) == sb["rows"]
assert api.post("/simulate", json={"block_id": syn["id"], "placements": []}).status_code == 200
# the agent works on an area that has no landmarks (no Places key): rules fallback, plan stays in budget
rec2 = api.post("/agent", json={"block_id": syn["id"], "budget_inr": 500_000, "brief": "cool the hottest streets"}).json()
assert rec2["metrics"]["total_cost_inr"] <= 500_000 and rec2["placements"]
# a synthetic stand-in is never final: once Earth Engine works again, the same box is rebuilt with real data
assert api.get(f"/areas/{syn['id']}").headers["cache-control"] == "no-cache"           # and the browser must revalidate it
earthengine.fetch_layers = fake_layers
again = api.post("/areas", json=other).json()
assert again == {"id": syn["id"], "cached": False}
healed = api.get(f"/areas/{syn['id']}")
assert healed.json()["synthetic"] is False and "immutable" in healed.headers["cache-control"]
assert api.post("/areas", json=other).json()["cached"] is True                          # real data IS cached from here on
print("areas: limits, grid, footprints, pipeline, API, synthetic fallback and agent-on-area all OK")
