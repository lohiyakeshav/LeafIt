"""The planner's self-critique and its enforcement: a plan that wastes trees in already-shaded spots is refused in code,
and the model (a scripted fake here) has to revise. Plus the place brief it reads and the answer it must give."""
import json

import numpy as np
import pytest

from app.agents import agent, checks, context
from app.domain import plantable, zones
from app.domain import species as species_mod
from app.domain.sim import Block
from tests.test_planner import FakeLLM, answer, call, reply
from tests.test_shade_and_rules import COLS, ROWS, blk


def shaded_block() -> Block:
    """A mostly-shaded area with one clear patch: naive planting here wastes trees; planting in the patch does not."""
    canopy = np.full((ROWS, COLS), 0.55)
    canopy[20:30, 20:30] = 0.0
    return blk(canopy_frac=canopy.tolist(), canopy_h=np.full((ROWS, COLS), 9.0).tolist())


def tool_results(llm) -> list[dict]:
    """Every tool result the model was shown, in order (what the planner said back to it)."""
    return [p.function_response.response["result"] for m in llm.seen for p in (m.parts or []) if getattr(p, "function_response", None)]


# ── the brief the agent reads ───────────────────────────────────────────────────────────────────────
def test_the_place_brief_describes_zones_hotspots_landmarks_and_rules(block):
    b = context.place_brief(block, 1_500_000, 10)
    assert [z["zone"] for z in b["zones"]] == zones.ZONES and b["place"]["climate_class"] == "hot_dry"
    named = {n for z in b["zones"] for n in z["landmarks"]}
    assert any(z["canopy_pct"] > 0 for z in b["zones"]) and named == {lm["name"] for lm in block.meta["landmarks"]}   # each landmark sits in its zone
    assert 1 <= len(b["hotspots"]) <= 5 and all(h["id"].startswith("H") and h["cells"] >= 3 for h in b["hotspots"])
    assert b["land"]["plantable_trees"] > 0 and b["rules"]["humid_airflow_rule"] is False
    assert {s["id"] for s in b["species"]} >= {"neem", "peepal", "pongamia"} and "generic" not in {s["id"] for s in b["species"]}
    assert b["data_quality"]["canopy_source"] == "meta_wri" and set(b["surroundings"]) == {"N", "E", "S", "W"} and b["people"]["residents"] > 0
    assert len(json.dumps(b)) < 16_000                                                       # small enough to read every time


def test_the_brief_describes_the_surroundings_and_people_when_the_area_has_them():
    pad = 6
    side = (ROWS + 2 * pad, COLS + 2 * pad)
    ring = {"pad": pad, "canopy_frac": np.zeros(side), "canopy_h": np.zeros(side), "lst_c": np.full(side, 40.0), "landcover": np.full(side, 50)}
    ring["canopy_frac"][:pad, :] = 0.7                                                       # a belt of trees along the north side
    ring["lst_c"][:pad, :] = 36.0
    ring = {k: (v if k == "pad" else v.tolist()) for k, v in ring.items()}
    pop = np.full((ROWS, COLS), 2.0)
    b = context.place_brief(blk(ring=ring, population=pop.tolist(), vulnerable=(pop * 0.2).tolist(),
                                roads=[{"name": "Ring Road", "type": "primary", "width_m": 14.0, "points": [[0, -30], [600, -30]]}]), 1e6, 10)
    s = b["surroundings"]
    assert s["N"]["canopy_pct"] == 70 and s["S"]["canopy_pct"] == 0 and s["N"]["vs_area_c"] < -5 > s["N"]["vs_area_c"] - 100
    assert s["N"]["big_roads"] == ["Ring Road"] and s["S"]["big_roads"] == []                # the road runs along the north side
    assert b["people"]["residents"] == ROWS * COLS * 2 and b["people"]["vulnerable_pct"] == 20
    assert all("vulnerable_residents" in z for z in b["zones"])


# ── check_plan ──────────────────────────────────────────────────────────────────────────────────────
def test_check_plan_counts_trees_wasted_in_existing_shade():
    b = shaded_block()
    naive = agent.Session(b, 600_000, 10)
    naive.run_scenario("naive", "average", ["tree"])
    careful = agent.Session(b, 600_000, 10)
    careful.run_scenario("careful", "average", ["tree"], avoid_shaded=True)
    bad, good = naive.check_plan("S1"), careful.check_plan("S1")
    assert bad["low_value_tree_ratio"] > checks.LOW_VALUE_LIMIT and any("avoid_shaded" in a for a in bad["advice"])
    assert good["low_value_tree_ratio"] == 0 and not any("avoid_shaded" in a for a in good["advice"])


def test_check_plan_reports_untouched_hot_and_vulnerable_zones(block):
    pop = np.zeros((ROWS, COLS))
    pop[-15:, -15:] = 3.0                                                                    # everyone lives in the south-east
    b = blk(population=pop.tolist(), vulnerable=(pop * 0.3).tolist())
    ok = plantable.capacity_grid(b, species_mod.get(None)) >= 1
    r0, c0 = next((int(r), int(c)) for r, c in np.argwhere(ok) if r < 15 and c < 15)           # a plantable cell in the north-west
    r = checks.check_plan(b, [{"type": "tree", "row": r0, "col": c0}], 10, None, 1e6)
    assert r["vulnerable_zones_untouched"] == ["SE"] and r["trees_per_zone"] == {"NW": 1}
    assert any("vulnerable" in a for a in r["advice"])


# ── the enforced revision loop ──────────────────────────────────────────────────────────────────────
def scenario(label="Naive", **kw):
    return call("run_scenario", label=label, goal="average", interventions=["tree"], **kw)


def test_a_wasteful_plan_is_refused_and_the_model_must_revise_it():
    b = shaded_block()
    fake = FakeLLM([
        reply(call("get_place_brief")),
        reply(scenario()),                                                                   # S1: plants everywhere, including inside shade
        reply(call("check_plan", scenario_id="S1")),
        reply(call("choose_scenario", scenario_id="S1", reason="most cooling")),            # → refused in code
        reply(scenario("Careful", avoid_shaded=True)),                                       # S2: the fix
        reply(call("check_plan", scenario_id="S2")),
        reply(call("choose_scenario", scenario_id="S2", reason="no wasted trees")),
        answer(),
    ])
    out = agent.plan(b, "cool the streets", 600_000, llm=fake)
    refusal = next(r for r in (m.parts[0].function_response.response["result"] for m in fake.seen[1:] if m.parts and getattr(m.parts[0], "function_response", None))
                   if r.get("refused"))
    assert refusal["revisions_left"] == 1 and "avoid_shaded" in refusal["why"]
    assert out["chosen"] == "S2" and out["checks"]["low_value_tree_ratio"] <= checks.LOW_VALUE_LIMIT
    assert [s["action"] for s in out["steps"] if s["action"].startswith(("Refused", "Chose"))] == ["Refused S1", "Chose S2"]


def test_choosing_before_checking_is_refused_and_an_override_is_honoured():
    fake = FakeLLM([reply(scenario()), reply(call("choose_scenario", scenario_id="S1", reason="x")),
                    reply(call("check_plan", scenario_id="S1")),
                    reply(call("choose_scenario", scenario_id="S1", reason="x", override_reason="the brief wants a dense grove")), answer()])
    out = agent.plan(shaded_block(), "dense grove please", 600_000, llm=fake)
    assert "check_plan" in next(r["why"] for r in tool_results(fake) if r.get("refused"))      # told to check first
    assert out["chosen"] == "S1" and any("kept despite shaded spots" in s["detail"] for s in out["steps"])   # the override was honoured, and says so


def test_after_two_refusals_the_best_checked_plan_wins():
    fake = FakeLLM([reply(scenario()), reply(call("check_plan", scenario_id="S1")),
                    *[reply(call("choose_scenario", scenario_id="S1", reason="stubborn"))] * 3, answer()])
    out = agent.plan(shaded_block(), "cool it", 600_000, llm=fake)
    actions = [s["action"] for s in out["steps"]]
    assert actions.count("Refused S1") == agent.MAX_REVISIONS and any(a.startswith("Revision limit reached") for a in actions)
    assert out["chosen"] == "S1"                                                             # only plan there was; the loop ended instead of hanging


def test_unknown_species_and_zones_are_reported_to_the_model_not_crashed(block):
    s = agent.Session(block, 500_000, 10)
    assert "unknown species" in s.call("run_scenario", {"label": "x", "goal": "average", "interventions": ["tree"], "species": "oak"})["error"]
    assert "unknown zone" in s.call("get_zone", {"zone": "XX"})["error"]
    assert s.call("check_plan", {"scenario_id": "S9"})["error"] == "no scenario S9"
    assert s.call("nonsense", {})["error"] == "unknown tool nonsense"


def test_shade_stop_intervention_reserves_budget_for_shelters(block):
    s = agent.Session(block, 3_000_000, 10)
    out = s.call("run_scenario", {"label": "People", "goal": "people", "interventions": ["tree", "shade_stop"]})
    assert out["shade_stops"] >= 1 and out["total_cost_inr"] <= 3_000_000


def test_the_final_answer_is_structured_and_every_number_in_it_is_checked(block):
    fake = FakeLLM([reply(call("get_place_brief")), reply(scenario()), reply(call("check_plan", scenario_id="S1")),
                    reply(call("choose_scenario", scenario_id="S1", reason="only one")),
                    answer(caveats=["The area is 8421 hectares."], zone_actions=[{"zone": "C", "action": "Plant 31337 trees", "why": "hot"}])])
    out = agent.plan(block, "x", 500_000, llm=fake)
    assert set(out["answer"]) == {"headline", "bullets", "zone_actions", "caveats"}
    assert 8421.0 in out["unverified_numbers"] and 31337.0 in out["unverified_numbers"]       # numbers inside zone actions and caveats are caught too


class Spy(FakeLLM):
    """A FakeLLM that keeps the very first message the planner sends."""
    first = None

    def generate_content(self, model, contents, config=None):
        self.first = self.first or contents[0]
        return super().generate_content(model, contents, config)


def test_the_agent_sends_two_labelled_maps_with_the_brief(block):
    spy = Spy([reply(call("get_place_brief")), reply(scenario()), reply(call("check_plan", scenario_id="S1")),
               reply(call("choose_scenario", scenario_id="S1", reason="x")), answer()])
    agent.plan(block, "x", 500_000, llm=spy)
    images = [p.inline_data for p in spy.first.parts if getattr(p, "inline_data", None)]
    assert spy.first.parts[0].text.startswith("Budget") and len(images) == 2
    assert all(i.mime_type == "image/png" and i.data[:8] == b"\x89PNG\r\n\x1a\n" for i in images)


def test_gemini_failing_midway_is_an_error_not_a_made_up_plan(block):
    with pytest.raises(agent.PlannerUnavailable):   # the script runs out: a broken model
        agent.plan(block, "hot streets", 500_000, llm=FakeLLM([reply(call("get_place_brief"))]))



def test_check_plan_flags_a_single_species_plan(block, cells):
    placements = [{"type": "tree", "row": int(r), "col": int(c), "species": "neem"} for r, c in cells.open[:30]]
    r = checks.check_plan(block, placements, 10, None, 2_000_000)
    assert r["dominant_species_share"] == 1.0 and any("one species" in a for a in r["advice"])
