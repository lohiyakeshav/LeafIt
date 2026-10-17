"""AI planner (PRD §9). Gemini turns a plain-language brief into simulator runs, compares them and explains its pick.
Every figure comes from the tools; the reply is checked for numbers that no tool produced.
Without Gemini, keyword rules choose the scenarios so the feature still works offline."""
import logging

from google.genai import types

from app.domain.optimise import optimise
from app.domain.sim import Block, simulate
from app.integrations.gemini import MODEL, client, unverified_numbers

MAX_TURNS = 8

SYSTEM = """You are LeafIt's urban-heat planner for Indian neighbourhoods. The user gives a brief and a budget.
1. Call get_block_overview.
2. Call run_scenario 2 to 4 times with settings that reflect the brief: focus on landmarks it mentions,
   "hotspots" when people's exposure matters, trees only when roofs should be avoided, and so on.
3. Call choose_scenario with the best match for the brief, not just the biggest number.
4. Reply with 3 to 5 short bullets, each starting with "- ", for a non-expert: what you chose, why it fits the brief,
   and the trade-off against the other options.
temp_reduction_c is street-level cooling (what people feel outdoors); surface_reduction_c also counts roof surfaces.
Use ONLY numbers returned by the tools. Never invent or estimate figures. Currency is INR. Reply in English."""

TOOLS = [types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="get_block_overview",
        description="Baseline heat, land cover, landmarks with their local temperature, air quality and the user's budget.",
        parameters_json_schema={"type": "object", "properties": {}},
    ),
    types.FunctionDeclaration(
        name="run_scenario",
        description="Build the most cost-effective plan for these settings with the simulator and return its estimated impact.",
        parameters_json_schema={"type": "object", "properties": {
            "label": {"type": "string", "description": "Short human name for this option"},
            "goal": {"type": "string", "enum": ["average", "hotspots"],
                     "description": "average = block-wide cooling; hotspots = the hottest outdoor cells where people are"},
            "interventions": {"type": "array", "items": {"type": "string", "enum": ["tree", "cool_roof"]}},
            "focus_landmarks": {"type": "array", "items": {"type": "string"},
                                "description": "Exact landmark names from the overview to prioritise"},
            "budget_inr": {"type": "number", "description": "Optional; capped at the user's budget"},
        }, "required": ["label", "goal", "interventions"]},
    ),
    types.FunctionDeclaration(
        name="choose_scenario",
        description="Pick the scenario to recommend.",
        parameters_json_schema={"type": "object", "properties": {
            "scenario_id": {"type": "string"}, "reason": {"type": "string"}}, "required": ["scenario_id", "reason"]},
    ),
])]


class Session:
    """Tool implementations; records every call as a visible reasoning step."""

    def __init__(self, block: Block, budget: float, years: int, unit_cost: dict | None = None):
        self.block, self.budget, self.years, self.unit_cost = block, budget, years, unit_cost
        self.scenarios: list[dict] = []
        self.steps: list[dict] = []
        self.chosen: str | None = None
        self.outputs: list = []  # everything the model was shown, for the numbers guardrail

    def call(self, name: str, args: dict) -> dict:
        fn = {"get_block_overview": self.overview, "run_scenario": self.run_scenario,
              "choose_scenario": self.choose}.get(name)
        try:
            out = fn(**args) if fn else {"error": f"unknown tool {name}"}
        except (TypeError, ValueError) as e:
            out = {"error": str(e)}
        self.outputs.append(out)
        return out

    def overview(self) -> dict:
        b = self.block
        landmarks = []
        for lm in b.meta.get("landmarks", []):
            r, c = lm["row"], lm["col"]
            near = b.lst[max(r - 5, 0):r + 6, max(c - 5, 0):c + 6]
            landmarks.append({"name": lm["name"], "kind": lm["kind"], "local_surface_temp_c": round(float(near.mean()), 1)})
        classes = b.meta["landcover_classes"]
        self.steps.append({"action": "Read the block", "detail": f"{len(landmarks)} landmarks, baseline heat and land cover"})
        return {
            "block": b.meta["name"], "area_m": [b.meta["rows"] * b.meta["cell_m"], b.meta["cols"] * b.meta["cell_m"]],
            "mean_surface_temp_c": round(float(b.lst.mean()), 1), "max_surface_temp_c": round(float(b.lst.max()), 1),
            "outdoor_mean_surface_temp_c": round(float(b.lst[b.outdoor].mean()), 1),
            "land_cover_pct": {k: round(float((b.landcover == i).mean() * 100), 1) for i, k in enumerate(classes)},
            "landmarks": landmarks, "baseline_aqi": b.meta.get("baseline_aqi"),
            "budget_inr": self.budget, "years_after_planting": self.years,
        }

    def run_scenario(self, label: str, goal: str = "average", interventions=("tree", "cool_roof"),
                     focus_landmarks=(), budget_inr: float | None = None) -> dict:
        kinds = tuple(t for t in interventions if t in ("tree", "cool_roof")) or ("tree", "cool_roof")
        budget = min(float(budget_inr or self.budget), self.budget)  # never above the user's budget
        lms = {lm["name"]: lm for lm in self.block.meta.get("landmarks", [])}
        focus = [(lms[n]["row"], lms[n]["col"]) for n in focus_landmarks if n in lms]
        plan = optimise(self.block, budget, "hotspots" if goal == "hotspots" else "average", self.years, kinds, focus, self.unit_cost)
        metrics = simulate(self.block, plan, self.years, self.unit_cost)["metrics"]
        sid = f"S{len(self.scenarios) + 1}"
        trees = sum(p.get("count", 1) for p in plan if p["type"] == "tree")
        roofs = sum(p["type"] == "cool_roof" for p in plan)
        self.scenarios.append({"id": sid, "label": label, "placements": plan, "metrics": metrics})
        self.steps.append({"action": f"Simulated {sid}: {label}",
                           "detail": f"{trees} trees, {roofs} cool roofs → −{metrics['temp_reduction_c']} °C avg, "
                                     f"{metrics['heat_exposure_pct']}% outdoor area still exposed"})
        return {"scenario_id": sid, "trees": trees, "cool_roofs": roofs,
                "focused_on": [n for n in focus_landmarks if n in lms], **metrics}

    def choose(self, scenario_id: str, reason: str = "") -> dict:
        if not any(s["id"] == scenario_id for s in self.scenarios):
            return {"error": f"no scenario {scenario_id}"}
        self.chosen = scenario_id
        self.steps.append({"action": f"Chose {scenario_id}", "detail": reason})
        return {"ok": True}


def _gemini(s: Session, brief: str, llm) -> str:
    cfg = types.GenerateContentConfig(
        system_instruction=SYSTEM, tools=TOOLS,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True), temperature=0.4)
    contents = [types.Content(role="user", parts=[types.Part(text=f"Budget: ₹{s.budget:,.0f}\nBrief: {brief}")])]
    for _ in range(MAX_TURNS):
        resp = llm.models.generate_content(model=MODEL, contents=contents, config=cfg)
        calls = resp.function_calls or []
        if not calls:
            return (resp.text or "").strip()
        contents.append(resp.candidates[0].content)
        contents.append(types.Content(role="user", parts=[
            types.Part.from_function_response(name=c.name, response={"result": s.call(c.name, dict(c.args or {}))})
            for c in calls]))
    raise RuntimeError("planner did not finish")


def _rules(s: Session, brief: str) -> str:
    text = brief.lower()
    lms = s.block.meta.get("landmarks", [])
    focus = [lm["name"] for lm in lms if lm["kind"] in text or lm["name"].lower() in text]
    no_roofs = "roof" in text and any(w in text for w in ("avoid", "no ", "without", "not "))
    hot = any(w in text for w in ("hot", "people", "walk", "wait", "children", "elderly", "kids"))
    kinds = ("tree",) if no_roofs else ("tree", "cool_roof")
    s.overview()
    s.run_scenario("Whole-block average cooling", "average", kinds)
    s.run_scenario("Hottest outdoor spots", "hotspots", kinds)
    if focus:
        s.run_scenario(f"Focus on {', '.join(focus)}", "hotspots", kinds, focus)
    pick = s.scenarios[-1] if focus else s.scenarios[1] if hot else max(s.scenarios, key=lambda x: x["metrics"]["temp_reduction_c"])
    why = ("it targets the places named in the brief" if focus else
           "the brief is about people's exposure" if hot else "it cools the block most")
    s.choose(pick["id"], f"Keyword rules: {why}")
    m = pick["metrics"]
    near = lambda x, n: x["metrics"]["landmark_cooling_c"].get(n, 0)
    focus_lines = [f"- Around the {n}: −{near(pick, n)} °C with this plan vs −{near(s.scenarios[0], n)} °C with "
                   f"whole-block cooling." for n in focus]
    lines = [f"- Recommended: {pick['label']}: estimated −{m['temp_reduction_c']} °C on average and up to "
             f"−{m['peak_reduction_c']} °C locally, for ₹{m['total_cost_inr']:,}.",
             f"- Chosen because {why}.", *focus_lines]
    lines += [f"- {o['label']}: −{o['metrics']['temp_reduction_c']} °C average, {o['metrics']['heat_exposure_pct']}% of "
              f"outdoor area still exposed (vs {m['heat_exposure_pct']}%)." for o in s.scenarios if o is not pick]
    if no_roofs:
        lines.append("- Roofs were left untouched, as the brief asked.")
    return "\n".join(lines)


def plan(block: Block, brief: str, budget: float, years: int = 10, llm=None, unit_cost: dict | None = None) -> dict:
    llm = llm or client()
    s, source, text = Session(block, budget, years, unit_cost), "rules", ""
    if llm:
        try:
            text, source = _gemini(s, brief, llm), "gemini"
            if not s.scenarios:
                raise RuntimeError("planner ran no scenarios")
        except Exception:
            logging.exception("Gemini planner failed, using rules")
            s, source = Session(block, budget, years, unit_cost), "rules"
    if source == "rules":
        text = _rules(s, brief)
    chosen = next((x for x in s.scenarios if x["id"] == s.chosen),
                  max(s.scenarios, key=lambda x: x["metrics"]["temp_reduction_c"]))
    return {
        "placements": chosen["placements"], **simulate(block, chosen["placements"], years, unit_cost), "chosen": chosen["id"],
        "scenarios": [{k: x[k] for k in ("id", "label", "metrics")} for x in s.scenarios],
        "steps": s.steps, "explanation": text, "source": source,
        "unverified_numbers": unverified_numbers(text, s.outputs, budget, years) if source == "gemini" else [],
    }
