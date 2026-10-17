"""AI planner (PRD §9). Gemini turns a plain-language brief into simulator runs, critiques them, and explains its pick.

What makes it more than a prompt:
  * it SEES the place: a brief of zones, hotspots, existing canopy, where trees can go, who lives where, what lies on each side
    of the box and the climate, plus two labelled maps (agents/context.py, agents/maps.py);
  * it has levers: goals, zones to focus on or avoid, species, a tree cap, shade shelters;
  * it must CHECK its plan (agents/checks.py), and choosing a plan that wastes trees in already-shaded spots is refused in code,
    so the revision loop is real and not a suggestion;
  * every figure comes from the tools, and the final answer is checked for numbers no tool produced.
Without Gemini, keyword rules run the same tools so the feature still works offline.
"""
import json
import logging

import numpy as np
from google.genai import types

from app.agents import checks, context, maps
from app.config import MODEL
from app.domain import plantable, zones
from app.domain import species as species_mod
from app.domain.optimise import PEOPLE_KINDS, optimise
from app.domain.sim import Block, simulate
from app.integrations.gemini import PLANNER_MODEL, PLANNER_THINKING, client, generate, unverified_numbers

MAX_TURNS = 16
HOMES_ROOF_SHARE = 0.25   # the rules planner's mixed option: a quarter of the budget to cool roofs on the most-lived-in homes
MAX_REVISIONS = 2     # a plan refused for wasting trees may be redone this many times; after that the best checked plan wins
GOALS = ("average", "hotspots", "people", "vulnerable")
INDOOR_C_RANGE = MODEL["roof"]["indoor_c_range"]

SYSTEM = """You are LeafIt's urban-heat planner for Indian neighbourhoods. The user gives a brief and a budget. You are shown a
heat map and a canopy map of the area (the same 3x3 zones NW N NE / W C E / SW S SE as the tools) and can read a place brief.

Work like this:
1. Call get_place_brief. Read it before planning: where it is hot, where shade already exists, where trees can physically go,
   who lives where, what lies on each side of the area, and the climate. Call get_zone for detail on a zone.
2. Call run_scenario 2 to 4 times with genuinely DIFFERENT strategies that serve the brief (not the same plan with a different
   label). Levers: goal (average, hotspots, people, vulnerable), focus_zones / avoid_zones, focus_landmarks, species, max_trees,
   interventions (tree, cool_roof, shade_stop). Leave species "auto" unless the brief asks for one.
3. Call check_plan on the scenario you prefer. If it reports a problem, FIX IT by running a better scenario (for example
   avoid_shaded=true), then check that one. choose_scenario is refused for plans that put more than 10% of their trees where
   existing shade already does most of the work, unless the brief itself calls for it (then give override_reason).
4. Call choose_scenario with the plan that best fits the brief, not just the biggest number.
5. Then you will be asked for the final answer.

How to plan well:
- People first: streets, bus stops, schools, clinics, markets, and the zones with many vulnerable residents.
- Extend shade FROM existing canopy edges toward the hot streets; do not densify shade that is already there.
- Use every tool, not only trees. Trees cool the street; cool roofs barely do, but they cool the rooms below (homes where people
  sleep through hot nights); shaded bus stops give shade where people wait. These serve different people, so the simulator cannot
  rank them on one scale: you weigh them against the brief. In most areas run at least one scenario with roof_budget_share
  (cool roofs on the homes with the most residents, or vulnerable residents for goal=vulnerable) and, when the brief mentions
  waiting, transit or bus stops or the brief lists mapped bus stops, one with shade_stop. Then say who each option serves:
  street cooling, residents under cool roofs, bus stops sheltered.
- Leave roofs out only if the brief says so; use them more where blocks are dense and ground to plant is scarce.
- Match species to the street and the climate: the catalogue says which suit this climate; large crowns need wide space.
- In a humid climate dense canopy can trap humid air and raise the heat index: prefer spaced trees, shade structures and
  cool roofs, and leave room for air to move (the simulator enforces a density limit there).
- Judge plans by cost per degree and by who benefits, not only by the average.
- Always name zones, roads and landmarks. Say what you could not know (data_quality in the brief).
temp_reduction_c is street-level surface cooling (what people feel outdoors on the ground); air_reduction_c is the smaller
air-temperature effect; equity_cooling_c is the cooling where vulnerable residents live (absent without population data).
Use ONLY numbers returned by the tools. Never invent or estimate figures. Currency is INR. Reply in English."""

_SCENARIO_PROPS = {
    "label": {"type": "string", "description": "Short human name for this option"},
    "goal": {"type": "string", "enum": list(GOALS),
             "description": "average = whole area; hotspots = the hottest outdoor ground; people = where people gather and live; "
                            "vulnerable = where children and the elderly live"},
    "interventions": {"type": "array", "items": {"type": "string", "enum": ["tree", "cool_roof", "shade_stop"]}},
    "species": {"type": "string", "description": "'auto' (default: best fit per cell for this climate) or a catalogue id from the brief"},
    "focus_landmarks": {"type": "array", "items": {"type": "string"}, "description": "Exact landmark names from the brief to prioritise"},
    "focus_zones": {"type": "array", "items": {"type": "string", "enum": zones.ZONES}, "description": "Zones to prioritise strongly"},
    "avoid_zones": {"type": "array", "items": {"type": "string", "enum": zones.ZONES}, "description": "Zones to leave alone"},
    "max_trees": {"type": "integer", "description": "Optional cap on the number of trees"},
    "avoid_shaded": {"type": "boolean", "description": "Skip spots where existing shade already does most of the work"},
    "roof_budget_share": {"type": "number", "description": "0 to 0.6: share of the budget for cool roofs on the homes with the most "
                          "residents (vulnerable residents when goal=vulnerable), before street cooling gets the rest. Needs cool_roof in interventions"},
    "budget_inr": {"type": "number", "description": "Optional; capped at the user's budget"},
}

TOOLS = [types.Tool(function_declarations=[
    types.FunctionDeclaration(name="get_place_brief", description="Everything known about the area: heat, canopy, zones, hotspots, people, surroundings, climate, species.",
                              parameters_json_schema={"type": "object", "properties": {}}),
    types.FunctionDeclaration(name="get_zone", description="Detail for one zone, including a 3x3 grid of its mean surface temperatures.",
                              parameters_json_schema={"type": "object", "properties": {"zone": {"type": "string", "enum": zones.ZONES}}, "required": ["zone"]}),
    types.FunctionDeclaration(name="run_scenario", description="Build the most cost-effective plan for these settings and return its estimated impact.",
                              parameters_json_schema={"type": "object", "properties": _SCENARIO_PROPS, "required": ["label", "goal", "interventions"]}),
    types.FunctionDeclaration(name="check_plan", description="Critique a scenario: budget used, trees per zone and species, trees wasted in existing shade, "
                              "hot or vulnerable zones left untouched, cooling at the surface, air and for the vulnerable, cost per degree.",
                              parameters_json_schema={"type": "object", "properties": {"scenario_id": {"type": "string"}}, "required": ["scenario_id"]}),
    types.FunctionDeclaration(name="choose_scenario", description="Pick the scenario to recommend (it must have been checked).",
                              parameters_json_schema={"type": "object", "properties": {
                                  "scenario_id": {"type": "string"}, "reason": {"type": "string"},
                                  "override_reason": {"type": "string", "description": "Only if the brief itself requires planting inside existing shade"}},
                                  "required": ["scenario_id", "reason"]}),
])]

ANSWER_SCHEMA = {"type": "object", "properties": {
    "headline": {"type": "string", "description": "One sentence: what the plan does and for whom"},
    "bullets": {"type": "array", "items": {"type": "string"}, "description": "3 to 5 short points: why it fits the brief, the trade-offs against the other options"},
    "zone_actions": {"type": "array", "items": {"type": "object", "properties": {
        "zone": {"type": "string", "enum": zones.ZONES}, "action": {"type": "string"}, "species": {"type": "string"}, "why": {"type": "string"}},
        "required": ["zone", "action", "why"]}, "description": "What happens where, naming roads and landmarks"},
    "caveats": {"type": "array", "items": {"type": "string"}, "description": "What the data could not tell, and the limits of the estimate"}},
    "required": ["headline", "bullets", "zone_actions", "caveats"]}


class Session:
    """Tool implementations; records every call as a visible reasoning step."""

    def __init__(self, block: Block, budget: float, years: int, unit_cost: dict | None = None):
        self.block, self.budget, self.years, self.unit_cost = block, budget, years, unit_cost
        self.scenarios: list[dict] = []
        self.steps: list[dict] = []
        self.chosen: str | None = None
        self.checked: dict[str, dict] = {}
        self.refusals = 0
        self.outputs: list = []  # everything the model was shown, for the numbers guardrail
        self._brief: dict | None = None
        self._capacity = plantable.capacity_grid(block, species_mod.get(None))

    def call(self, name: str, args: dict) -> dict:
        fn = {"get_place_brief": self.get_place_brief, "get_zone": self.get_zone, "run_scenario": self.run_scenario,
              "check_plan": self.check_plan, "choose_scenario": self.choose}.get(name)
        try:
            out = fn(**args) if fn else {"error": f"unknown tool {name}"}
        except (TypeError, ValueError) as e:
            out = {"error": str(e)}
        self.outputs.append(out)
        return out

    @property
    def brief(self) -> dict:
        if self._brief is None:
            self._brief = context.place_brief(self.block, self.budget, self.years)
        return self._brief

    def get_place_brief(self) -> dict:
        b = self.brief
        self.steps.append({"action": "Read the place",
                           "detail": f"{len(b['zones'])} zones, {len(b['hotspots'])} hotspots, {len(b['landmarks'])} landmarks, "
                                     f"existing canopy {b['land']['existing_canopy_pct']}%, climate {b['place']['climate_class'] or 'unknown'}"})
        return b

    def get_zone(self, zone: str) -> dict:
        if zone not in zones.ZONES:
            raise ValueError(f"unknown zone {zone}")
        rows, cols = self.block.lst.shape
        r0, r1, c0, c1 = zones.bounds(rows, cols)[zone]
        d = context.zone_stats(self.block, zone, self._capacity)
        rs, cs = np.linspace(r0, r1, 4).round().astype(int), np.linspace(c0, c1, 4).round().astype(int)
        d["sub_grid_mean_c"] = [[round(float(self.block.lst[rs[i]:rs[i + 1], cs[j]:cs[j + 1]].mean()), 1) for j in range(3)] for i in range(3)]
        self.steps.append({"action": f"Looked closer at the {zones.LABELS[zone]}", "detail": ""})
        return d

    def run_scenario(self, label: str, goal: str = "average", interventions=("tree", "cool_roof"), species: str = "auto",
                     focus_landmarks=(), focus_zones=(), avoid_zones=(), max_trees: int | None = None,
                     avoid_shaded: bool = False, budget_inr: float | None = None, roof_budget_share: float = 0.0) -> dict:
        kinds = tuple(t for t in interventions if t in ("tree", "cool_roof"))
        if not kinds and "shade_stop" not in interventions:   # nothing usable asked for: the default mix
            kinds = ("tree", "cool_roof")
        if species != "auto" and species not in species_mod.BY_ID:
            raise ValueError(f"unknown species {species}; use 'auto' or one of {sorted(species_mod.BY_ID)}")
        budget = min(float(budget_inr or self.budget), self.budget)  # never above the user's budget
        lms = {lm["name"]: lm for lm in self.block.meta.get("landmarks", [])}
        focus = [(lms[n]["row"], lms[n]["col"]) for n in focus_landmarks if n in lms]
        plan = optimise(self.block, budget, goal if goal in GOALS else "average", self.years, kinds, focus, self.unit_cost, species=species,
                        focus_zones=[z for z in focus_zones if z in zones.ZONES], avoid_zones=[z for z in avoid_zones if z in zones.ZONES],
                        max_trees=max_trees, avoid_shaded=avoid_shaded, include_shade_stops="shade_stop" in interventions,
                        roof_share=float(roof_budget_share or 0) if "cool_roof" in kinds else 0.0)
        metrics = simulate(self.block, plan, self.years, self.unit_cost)["metrics"]
        sid = f"S{len(self.scenarios) + 1}"
        trees = sum(p.get("count", 1) for p in plan if p["type"] == "tree")
        roofs = sum(p["type"] == "cool_roof" for p in plan)
        stops = sum(p["type"] == "shade_stop" for p in plan)
        self.scenarios.append({"id": sid, "label": label, "placements": plan, "metrics": metrics, "goal": goal})
        self.steps.append({"action": f"Simulated {sid}: {label}",
                           "detail": f"{trees} trees, {roofs} cool roofs{f', {stops} shelters' if stops else ''} → −{metrics['temp_reduction_c']} °C avg, "
                                     f"{metrics['heat_exposure_pct']}% outdoor area still exposed"})
        keep = ("temp_reduction_c", "air_reduction_c", "equity_cooling_c", "peak_reduction_c", "heat_exposure_pct", "heat_exposure_reduction_pct",
                "total_cost_inr", "cost_per_degree_inr", "co2_captured_kg_per_year", "landmark_cooling_c")
        rep = checks.check_plan(self.block, plan, self.years, self.unit_cost, self.budget)
        who = {k: rep[k] for k in ("cool_roof_m2", "residents_under_cool_roofs", "vulnerable_under_cool_roofs", "bus_stops_sheltered")}
        if roofs:
            who["cool_roof_indoor_c_range"] = INDOOR_C_RANGE   # measured in pilots, for context: the simulator does not model rooms
        return {"scenario_id": sid, "trees": trees, "cool_roofs": roofs, "shade_stops": stops, "goal": goal,
                "focused_on": [n for n in focus_landmarks if n in lms], **{k: metrics[k] for k in keep}, **who}

    def _scenario(self, scenario_id: str) -> dict:
        sc = next((s for s in self.scenarios if s["id"] == scenario_id), None)
        if sc is None:
            raise ValueError(f"no scenario {scenario_id}")
        return sc

    def check_plan(self, scenario_id: str) -> dict:
        sc = self._scenario(scenario_id)
        rep = checks.check_plan(self.block, sc["placements"], self.years, self.unit_cost, self.budget)
        self.checked[scenario_id] = rep
        verdict = "no problems found" if not rep["advice"] else f"{len(rep['advice'])} issue(s): " + " ".join(rep["advice"])
        self.steps.append({"action": f"Checked {scenario_id}", "detail": f"{verdict} · {round(100 * rep['low_value_tree_ratio'])}% of trees in already-shaded spots"})
        return rep

    def best_checked(self) -> str:
        """The checked plan with the fewest wasted trees, then the most cooling: what wins when the revision limit is reached."""
        pool = [s for s in self.scenarios if s["id"] in self.checked] or self.scenarios
        for s in pool:
            self.checked.setdefault(s["id"], checks.check_plan(self.block, s["placements"], self.years, self.unit_cost, self.budget))
        return min(pool, key=lambda s: (self.checked[s["id"]]["low_value_tree_ratio"] > checks.LOW_VALUE_LIMIT, -s["metrics"]["temp_reduction_c"]))["id"]

    def choose(self, scenario_id: str, reason: str = "", override_reason: str | None = None) -> dict:
        self._scenario(scenario_id)
        rep = self.checked.get(scenario_id)
        if rep is None:
            return {"refused": True, "why": f"Run check_plan on {scenario_id} first, so the choice rests on a checked plan."}
        if rep["low_value_tree_ratio"] > checks.LOW_VALUE_LIMIT and not override_reason:
            self.refusals += 1
            if self.refusals <= MAX_REVISIONS:
                msg = (f"{round(100 * rep['low_value_tree_ratio'])}% of its trees would sit where existing shade already does most of the work. "
                       "Run it again with avoid_shaded=true (or avoid_zones), check that, and choose again.")
                self.steps.append({"action": f"Refused {scenario_id}", "detail": msg})
                return {"refused": True, "why": msg, "revisions_left": MAX_REVISIONS - self.refusals}
            pick = self.best_checked()
            self.chosen = pick
            self.steps.append({"action": f"Revision limit reached: kept {pick}", "detail": "the checked plan with the fewest trees in already-shaded spots"})
            return {"ok": True, "chosen": pick, "note": "revision limit reached; kept the best checked plan"}
        self.chosen = scenario_id
        self.steps.append({"action": f"Chose {scenario_id}", "detail": reason + (f" (kept despite shaded spots: {override_reason})" if override_reason else "")})
        return {"ok": True}


def _gemini(s: Session, brief: str, llm) -> dict:
    cfg = types.GenerateContentConfig(system_instruction=SYSTEM, tools=TOOLS, temperature=0.4,
                                      thinking_config=types.ThinkingConfig(thinking_budget=PLANNER_THINKING),
                                      automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True))
    parts = [types.Part(text=f"Budget: ₹{s.budget:,.0f}\nYears after planting: {s.years}\nBrief: {brief}"),
             types.Part.from_bytes(data=maps.heat_map(s.block), mime_type="image/png"),
             types.Part.from_bytes(data=maps.canopy_map(s.block), mime_type="image/png")]
    contents = [types.Content(role="user", parts=parts)]
    for _ in range(MAX_TURNS):
        resp = generate(llm, model=PLANNER_MODEL, contents=contents, config=cfg)
        calls = resp.function_calls or []
        if not calls:
            break
        contents.append(resp.candidates[0].content)
        contents.append(types.Content(role="user", parts=[
            types.Part.from_function_response(name=c.name, response={"result": s.call(c.name, dict(c.args or {}))}) for c in calls]))
        if s.chosen:
            break
    if not s.scenarios:
        raise RuntimeError("planner ran no scenarios")
    if not s.chosen:
        s.chosen = s.best_checked()
        s.steps.append({"action": f"Chose {s.chosen}", "detail": "the planner did not choose, so the best checked plan was kept"})
    contents.append(types.Content(role="user", parts=[types.Part(text=(
        f"Write the final answer for the chosen plan {s.chosen} now. Use only numbers the tools returned. "
        f"Check report for it: {json.dumps(s.checked.get(s.chosen, {}), ensure_ascii=False)}"))]))
    final = generate(llm, model=PLANNER_MODEL, contents=contents, config=types.GenerateContentConfig(
        system_instruction=SYSTEM, response_mime_type="application/json", response_json_schema=ANSWER_SCHEMA, temperature=0.3))
    return json.loads(final.text)


def _rules(s: Session, brief: str) -> dict:
    """Keyword rules driving the same tools, so the feature works without Gemini."""
    text = brief.lower()
    lms = s.block.meta.get("landmarks", [])
    focus = [lm["name"] for lm in lms if lm["kind"] in text or lm["name"].lower() in text]
    no_roofs = "roof" in text and any(w in text for w in ("avoid", "no ", "without", "not "))
    people = any(w in text for w in ("hot", "people", "walk", "wait", "children", "elderly", "kids", "school"))
    homes = not no_roofs and any(w in text for w in ("home", "house", "roof", "indoor", "sleep", "night", "everything", "all options"))
    kinds = ["tree"] if no_roofs else ["tree", "cool_roof"]
    has_people_data = s.block.exposure is not None
    s.get_place_brief()
    s.run_scenario("Whole-area cooling", "average", kinds, avoid_shaded=True)
    s.run_scenario("Hottest ground first", "hotspots", kinds, avoid_shaded=True)
    if has_people_data or any(lm["kind"] in PEOPLE_KINDS for lm in lms):
        s.run_scenario("People first", "vulnerable" if has_people_data else "people", [*kinds, "shade_stop"], avoid_shaded=True)
    if not no_roofs:
        s.run_scenario("Streets, homes and stops", "vulnerable" if has_people_data else "people", ["tree", "cool_roof", "shade_stop"],
                       avoid_shaded=True, roof_budget_share=HOMES_ROOF_SHARE)
    if focus:
        s.run_scenario(f"Focus on {', '.join(focus)}", "hotspots", kinds, focus_landmarks=focus, avoid_shaded=True)
    for sc in s.scenarios:
        s.check_plan(sc["id"])
    by_goal = {sc["goal"]: sc for sc in s.scenarios if sc["label"] != "Streets, homes and stops"}
    people_pick = by_goal.get("vulnerable") or by_goal.get("people")
    mixed = next((sc for sc in s.scenarios if sc["label"] == "Streets, homes and stops"), None)
    if focus:
        pick, why = s.scenarios[-1], "it targets the places named in the brief"
    elif mixed and homes:
        pick, why = mixed, "the brief is about homes and the people waiting outside, not only the streets"
    elif people and people_pick:
        pick, why = people_pick, "the brief is about people's exposure"
    else:
        pick, why = max(s.scenarios, key=lambda x: x["metrics"]["temp_reduction_c"]), "it cools the area most"
    s.choose(pick["id"], f"Keyword rules: {why}")
    return _rules_answer(s, pick, focus, no_roofs, why)


def _rules_answer(s: Session, pick: dict, focus: list[str], no_roofs: bool, why: str) -> dict:
    m = pick["metrics"]
    rows, cols = s.block.lst.shape
    near = lambda x, n: x["metrics"]["landmark_cooling_c"].get(n, 0)
    bullets = [f"Estimated −{m['temp_reduction_c']} °C on average across streets and open ground, up to −{m['peak_reduction_c']} °C at the most improved spots, "
               f"for ₹{m['total_cost_inr']:,}.",
               f"Chosen because {why}.",
               *[f"Around the {n}: −{near(pick, n)} °C with this plan vs −{near(s.scenarios[0], n)} °C with whole-area cooling." for n in focus]]
    bullets += [f"{o['label']}: −{o['metrics']['temp_reduction_c']} °C average, {o['metrics']['heat_exposure_pct']}% of outdoor area still exposed "
                f"(vs {m['heat_exposure_pct']}%)." for o in s.scenarios if o is not pick]
    if no_roofs:
        bullets.append("Roofs were left untouched, as the brief asked.")
    per_zone: dict[str, dict] = {}
    for p in pick["placements"]:
        z = per_zone.setdefault(zones.zone_of(p["row"], p["col"], rows, cols), {"trees": 0, "roofs": 0, "stops": 0})
        z["trees" if p["type"] == "tree" else "roofs" if p["type"] == "cool_roof" else "stops"] += p.get("count", 1)
    actions = []
    for name, n in sorted(per_zone.items(), key=lambda kv: -sum(kv[1].values()))[:4]:
        roads = context.zone_stats(s.block, name, s._capacity)["roads"]
        bits = [f"{n['trees']} trees" if n["trees"] else "", f"{n['roofs']} cool roofs" if n["roofs"] else "", f"{n['stops']} shaded stops" if n["stops"] else ""]
        actions.append({"zone": name, "action": "Plant and install " + ", ".join(b for b in bits if b) + (f" along {roads[0]}" if roads else ""),
                        "why": f"One of the hotter or busier parts of the area ({zones.LABELS[name]})."})
    pick_checks = s.checked.get(pick["id"])
    q = s.brief["data_quality"]
    caveats = ["These are model estimates, not measurements."]
    if q["canopy_source"] not in ("meta_wri", None):
        caveats.append(f"Existing tree cover came from a coarser source ({q['canopy_source']}), so shaded spots may be misjudged.")
    if q["population_source"] is None:
        caveats.append("No population data: the plan cannot favour where vulnerable people live.")
    if pick_checks and pick_checks["trees"] >= 20 and pick_checks["dominant_species_share"] > checks.MONOCULTURE_SHARE:
        caveats.append("Most trees are one species. Mixing species would protect against pests and disease; choose species yourself to do that.")
    return {"headline": f"{pick['label']}: the best fit for the brief within the budget.", "bullets": bullets, "zone_actions": actions, "caveats": caveats}


def _text(answer: dict) -> str:
    """All the prose of an answer, for the numbers guardrail."""
    parts = [answer.get("headline", ""), *answer.get("bullets", []), *answer.get("caveats", [])]
    parts += [f"{a.get('action', '')} {a.get('why', '')} {a.get('species', '')}" for a in answer.get("zone_actions", [])]
    return "\n".join(parts)


def plan(block: Block, brief: str, budget: float, years: int = 10, llm=None, unit_cost: dict | None = None) -> dict:
    llm = llm or client()
    s, source, answer = Session(block, budget, years, unit_cost), "rules", {}
    if llm:
        try:
            answer, source = _gemini(s, brief, llm), "gemini"
        except Exception:
            logging.exception("Gemini planner failed, using rules")
            s, source = Session(block, budget, years, unit_cost), "rules"
    if source == "rules":
        answer = _rules(s, brief)
    chosen = next((x for x in s.scenarios if x["id"] == s.chosen), max(s.scenarios, key=lambda x: x["metrics"]["temp_reduction_c"]))
    return {
        "placements": chosen["placements"], **simulate(block, chosen["placements"], years, unit_cost), "chosen": chosen["id"],
        "scenarios": [{k: x[k] for k in ("id", "label", "metrics")} for x in s.scenarios],
        "steps": s.steps, "answer": answer, "explanation": "\n".join(f"- {b}" for b in answer.get("bullets", [])), "source": source,
        "checks": s.checked.get(chosen["id"]) or checks.check_plan(block, chosen["placements"], years, unit_cost, budget),
        "unverified_numbers": unverified_numbers(_text(answer), s.outputs, budget, years) if source == "gemini" else [],
    }
