"""The budget optimiser and the planner agent (the Gemini tool loop with a scripted fake)."""
import json

import numpy as np
import pytest
from google.genai import types as gt

from app.agents import agent
from app.domain.optimise import optimise


def test_optimiser_stays_in_budget_and_beats_naive(cells, block):
    plan = optimise(block, 1_500_000)
    assert 0 < cells.metrics(plan)["total_cost_inr"] <= 1_500_000
    assert cells.metrics(plan)["temp_reduction_c"] > cells.metrics(cells.trees(500))["temp_reduction_c"]


def test_optimiser_focus_moves_the_plan(block):
    school = next(lm for lm in block.meta["landmarks"] if lm["kind"] == "school")
    dist = lambda plan: np.mean([abs(p["row"] - school["row"]) + abs(p["col"] - school["col"]) for p in plan])
    assert dist(optimise(block, 300_000, "hotspots", focus=[(school["row"], school["col"])])) < dist(optimise(block, 300_000, "hotspots"))


def test_cheaper_prices_buy_more(block):
    no_roofs = {"cool_roof": 10**6}
    assert len(optimise(block, 300_000, unit_cost={"tree": 1500, **no_roofs})) > len(optimise(block, 300_000, unit_cost=no_roofs))


def test_agent_needs_a_brief_and_gemini(api):
    req = {"block_id": "lajpat_nagar", "budget_inr": 1_500_000}
    assert api.post("/agent", json={**req, "brief": "   "}).status_code == 422          # nothing to plan for
    r = api.post("/agent", json={**req, "brief": "Keep children walking to the school cool"})   # tests run without Gemini
    assert r.status_code == 503 and "AI planner" in r.json()["detail"]
    pricey = api.post("/agent", json={**req, "brief": "cool it", "budget_inr": 20_000, "unit_cost": {"tree": 25_000}})
    assert pricey.status_code == 422 and "single tree" in pricey.json()["detail"]   # the budget can't buy even one tree

def reply(*parts):
    return gt.GenerateContentResponse(candidates=[gt.Candidate(content=gt.Content(role="model", parts=list(parts)))])


def call(name, **args):
    return gt.Part(function_call=gt.FunctionCall(name=name, args=args))


class FakeLLM:
    def __init__(self, script):
        self.script, self.seen = script, []
        self.models = self

    def generate_content(self, model, contents, config=None):
        self.seen.append(contents[-1])
        step = self.script.pop(0)                             # IndexError when the script runs out: a "broken" model
        return step(self) if callable(step) else step


def answer(**over):
    """A structured final answer as the model returns it (JSON text)."""
    body = {"headline": "Plant along the school road.", "bullets": ["It fits the brief."], "caveats": ["Model estimates."],
            "zone_actions": [{"zone": "E", "action": "Plant near the school", "why": "Children walk here."}], **over}
    return reply(gt.Part(text=json.dumps(body)))


def test_gemini_loop_caps_budget_checks_the_plan_and_flags_invented_numbers(block):
    def final(llm):  # quotes a real tool number and one invented number
        s2 = llm.seen[2].parts[1].function_response.response["result"]       # the tool's answer for S2, from the turn it arrived in
        return answer(bullets=[f"S2 cools the school area by {s2['peak_reduction_c']} °C.", "It also saves 987654 rupees."])

    fake = FakeLLM([
        reply(call("get_place_brief")),
        reply(call("run_scenario", label="Average", goal="average", interventions=["tree", "cool_roof"]),
              call("run_scenario", label="School", goal="hotspots", interventions=["tree"],
                   focus_landmarks=["Government school"], budget_inr=9e9)),
        reply(call("check_plan", scenario_id="S2")),
        reply(call("choose_scenario", scenario_id="S2", reason="brief is about the school")),
        final,
    ])
    out = agent.plan(block, "school kids", 1_000_000, llm=fake)
    assert out["source"] == "gemini" and out["chosen"] == "S2" and [s["label"] for s in out["scenarios"]] == ["Average", "School"]
    assert out["metrics"]["total_cost_inr"] <= 1_000_000      # the model's budget_inr=9e9 was capped
    assert out["unverified_numbers"] == [987654.0]             # invented figure caught, real one accepted
    assert any(s["action"].startswith("Chose S2") for s in out["steps"]) and out["checks"]["trees"] > 0
    assert out["answer"]["zone_actions"][0]["zone"] == "E" and out["explanation"].startswith("- ")
    # every option comes back browsable: its own placements and a per-zone breakdown that adds up to them
    for sc in out["scenarios"]:
        sm, pl = sc["summary"], sc["placements"]
        assert sm["trees"] == sum(p.get("count", 1) for p in pl if p["type"] == "tree") == sum(sm["species"].values())
        assert sum(z["trees"] + z["cool_roofs"] + z["shade_stops"] for z in sm["zones"]) == sm["trees"] + sm["cool_roofs"] + sm["shade_stops"]
    assert next(sc for sc in out["scenarios"] if sc["id"] == "S2")["placements"] == out["placements"]


def test_broken_model_is_an_error_not_a_made_up_plan(block):
    with pytest.raises(agent.PlannerUnavailable):
        agent.plan(block, "hot streets", 500_000, llm=FakeLLM([]))


def test_auto_species_is_a_mix_not_a_monoculture(block):
    from app.domain.optimise import optimise
    by = {}
    for p in optimise(block, 2_000_000, species="auto", years=10, types=("tree",)):
        by[p["species"]] = by.get(p["species"], 0) + p.get("count", 1)
    assert len(by) >= 3 and max(by.values()) <= 0.3 * sum(by.values()) + 1, by


def test_guardrail_accepts_a_share_written_as_percent_but_not_an_invented_one():
    from app.integrations.gemini import unverified_numbers
    tool_output = {"trees_beside_existing_canopy_ratio": 0.733, "budget_used_pct": 99.9}
    assert unverified_numbers("73.3% of the trees sit beside existing canopy, using 99.9% of the budget", tool_output) == []
    assert unverified_numbers("a further 61.7% is shaded", tool_output) == [61.7]


def test_roof_share_buys_cool_roofs_for_the_most_lived_in_homes_and_stops_go_to_bus_stops():
    from app.agents import checks
    from app.domain.optimise import optimise
    from app.domain.sim import Block
    from tests.test_shade_and_rules import RAW
    pop = np.zeros((len(RAW["lst_c"]), len(RAW["lst_c"][0])))
    roofs = np.argwhere(np.array(RAW["roof_area_m2"]) > 0)
    r0, c0 = map(int, roofs[len(roofs) // 2])
    pop[r0, c0] = 500                                           # one crowded building
    b = Block.from_dict({**RAW, "population": pop.tolist(), "vulnerable": (pop / 5).tolist(),
                         "exposure": pop.tolist(), "landmarks": []})
    plan = optimise(b, 1_000_000, "vulnerable", roof_share=0.3)
    roofs_bought = {(p["row"], p["col"]) for p in plan if p["type"] == "cool_roof"}
    assert (r0, c0) in roofs_bought and any(p["type"] == "tree" for p in plan)
    rep = checks.check_plan(b, plan, 10, None, 1_000_000)
    assert rep["residents_under_cool_roofs"] >= 500 and rep["cool_roofs"] == len(roofs_bought)
    assert not any(p["type"] == "cool_roof" and (p["row"], p["col"]) == (r0, c0) for p in optimise(b, 1_000_000, "vulnerable"))  # off by default

    road = np.argwhere(np.array(RAW["landcover"]) == RAW["landcover_classes"].index("road"))
    rs, cs = map(int, road[len(road) // 3])
    with_stop = Block.from_dict({**RAW, "landmarks": [{"name": "Stop A", "kind": "bus stop", "row": rs, "col": cs}]})
    plan = optimise(with_stop, 2_000_000, "people", include_shade_stops=True)
    assert checks.check_plan(with_stop, plan, 10, None, 2_000_000)["bus_stops_sheltered"] == ["Stop A"]


def test_species_cap_holds_when_enough_species_fit_and_the_real_share_is_reported(block):
    from app.agents import checks
    from app.domain.optimise import MAX_SPECIES_SHARE, optimise
    plan = optimise(block, 1_000_000, "average", species="auto", types=("tree",))
    by = {}
    for p in plan:
        by[p["species"]] = by.get(p["species"], 0) + p["count"]
    assert max(by.values()) <= MAX_SPECIES_SHARE * sum(by.values()) + 2, by          # within a cell's worth of the cap
    rep = checks.check_plan(block, plan, 10, None, 1_000_000)
    assert rep["dominant_species_share"] == round(max(by.values()) / sum(by.values()), 3)


def test_rate_limit_waits_follow_the_server_and_daily_quotas_are_not_waited_out(monkeypatch):
    from google.genai import errors as ge

    from app.integrations import gemini
    assert gemini._retry_after(Exception("Please retry in 428.69ms.")) == 0.42869
    assert gemini._retry_after(Exception("Please retry in 20.7s.")) == 20.7 and gemini._retry_after(Exception("nope")) == 15.0
    slept = []
    monkeypatch.setattr(gemini.time, "sleep", slept.append)

    class Flaky:
        def __init__(self, errs):
            self.errs, self.models = list(errs), self

        def generate_content(self, **kw):
            if self.errs:
                raise self.errs.pop(0)
            return "ok"
    minute = ge.ClientError(429, {"error": {"message": "quota GenerateRequestsPerMinute. Please retry in 2s.", "status": "RESOURCE_EXHAUSTED"}})
    assert gemini.generate(Flaky([minute, ge.ServerError(503, {"error": {"message": "busy"}})])) == "ok" and slept == [3.0, 3.0]
    daily = ge.ClientError(429, {"error": {"message": "quota GenerateRequestsPerDayPerProject. Please retry in 2s."}})
    with pytest.raises(ge.ClientError):
        gemini.generate(Flaky([daily]))


def test_vendor_lookups_reject_ids_that_are_not_places_ids(monkeypatch):
    from app import config
    from app.integrations import vendors
    monkeypatch.setattr(config, "GOOGLE_MAPS_SERVER_KEY", "k")
    calls = []
    monkeypatch.setattr(vendors.httpx, "get", lambda *a, **k: calls.append(a) or (_ for _ in ()).throw(RuntimeError("down")))
    for bad in ("nursery:../../x", "nope:ChIJabcdefghij", "nursery:short", "nursery:" + "a" * 400):
        assert vendors.get(bad) is None
    assert calls == []                                                                   # none of those reached Google
    assert vendors.get("nursery:ChIJabcdefghij") is None and vendors.get("nursery:ChIJabcdefghij") is None
    assert len(calls) == 1                                                               # a miss is remembered, not re-billed


def test_the_daily_gemini_allowance_stops_spending(block, monkeypatch):
    from app.integrations import gemini
    monkeypatch.setattr(gemini, "DAILY_CALL_LIMIT", 2)
    monkeypatch.setattr(gemini, "_spend_day", None)
    llm = FakeLLM([reply(call("get_place_brief"))] * 5)
    with pytest.raises(agent.PlannerUnavailable, match="allowance"):   # the third call is refused before it reaches Gemini
        agent.plan(block, "hot streets", 500_000, llm=llm)
    assert len(llm.seen) == 2
