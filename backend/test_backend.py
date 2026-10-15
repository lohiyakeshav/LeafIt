"""Run: .venv/bin/python test_backend.py  (from backend/)"""
import os
import tempfile
import time
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from app import market
from app.main import BLOCKS, app
from app.optimise import optimise
from app.sim import ASSUMPTIONS, maturity
from app.sim import simulate

block, _ = BLOCKS["demo_lajpat"]
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
from app import agent


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
market.PLANS = Path(tempfile.mkdtemp())
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
