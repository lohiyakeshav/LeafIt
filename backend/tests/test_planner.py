"""The budget optimiser and the planner agent (rules fallback and the Gemini tool loop with a scripted fake)."""
import numpy as np
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


def test_agent_offline_rules_pick_the_landmark_scenario(api):
    rec = api.post("/agent", json={"block_id": "demo_lajpat", "budget_inr": 1_500_000,
                                   "brief": "Keep children walking to the school cool, avoid roofs"}).json()
    assert rec["source"] == "rules" and rec["explanation"].startswith("- ")
    assert rec["chosen"] == rec["scenarios"][-1]["id"] and "Government school" in rec["scenarios"][-1]["label"]
    assert all(p["type"] == "tree" for p in rec["placements"]) and rec["metrics"]["total_cost_inr"] <= 1_500_000
    assert len(rec["steps"]) == 5                            # overview, 3 scenarios, choice
    near = lambda sc: sc["metrics"]["landmark_cooling_c"]["Government school"]
    assert near(rec["scenarios"][-1]) > near(rec["scenarios"][0])
    assert "Around the Government school" in rec["explanation"]


# ---- Gemini tool loop, driven by a scripted fake built from real SDK types ------------------------------------------
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


def test_gemini_loop_caps_budget_and_flags_invented_numbers(block):
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
    assert out["metrics"]["total_cost_inr"] <= 1_000_000      # the model's budget_inr=9e9 was capped
    assert out["unverified_numbers"] == [987654.0]             # invented figure caught, real one accepted
    assert any(s["action"].startswith("Chose S2") for s in out["steps"])


def test_broken_model_falls_back_to_rules(block):
    assert agent.plan(block, "hot streets", 500_000, llm=FakeLLM([])).get("source") == "rules"
