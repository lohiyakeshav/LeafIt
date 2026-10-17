"""Live planner evaluation: the Gemini agent against the offline rules planner, on real areas and a handful of briefs.

    cd backend && conda run -n leafit python scripts/agent_eval.py [--areas lajpat,gachibowli] [--briefs 0,1,2] [--rules-only]

Needs Earth Engine (to build the areas) and GEMINI_API_KEY (for the agent; without it only the rules planner runs).
For each area x brief it prints what a reviewer would check: whether the plan is sensible (trees on shaded ground, zones named,
vulnerable zones left out), whether the prose invented numbers, cooling (surface, air, equity), cost per degree and time.
Areas are cached under backend/data/eval_areas so repeat runs are quick.
"""
import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parents[1]))
from app.agents import agent  # noqa: E402
from app.domain.area.grid import Bounds  # noqa: E402
from app.domain.sim import Block  # noqa: E402
from app.integrations import gemini  # noqa: E402
from app.services import area_builder  # noqa: E402

AREAS = {"lajpat": (28.5704, 77.2402, "Lajpat Nagar, Delhi"), "gachibowli": (17.4401, 78.3489, "Gachibowli, Hyderabad")}
BRIEFS = [
    "Keep children walking to the school cool",
    "Protect elderly residents; leave roofs alone",
    "Small budget: the most cooling per rupee",
    "Cool the streets where people wait for buses and shop at the market",
    "Best average cooling for the whole block",
    "Hot humid city: shade people without trapping heat",
]
BUDGET = {2: 300_000}
CACHE = Path(__file__).parents[1] / "data" / "eval_areas"


def load_area(key: str) -> Block:
    lat, lng, name = AREAS[key]
    path = CACHE / f"{key}.json"
    if not path.exists() or json.loads(path.read_text()).get("roads_source") != "osm":   # roads are part of the test: retry until OSM answers
        dlat, dlng = 300 / 111_320, 300 / (111_320 * np.cos(np.radians(lat)))
        for _ in range(4):
            data = asyncio.run(area_builder.build_area(Bounds(lat + dlat, lat - dlat, lng + dlng, lng - dlng), name))
            if data.get("roads_source") == "osm":
                break
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
    return Block.from_dict(json.loads(path.read_text()))


def run(block: Block, brief: str, budget: float, llm) -> dict:
    t = time.perf_counter()
    out = agent.plan(block, brief, budget, 10, llm=llm)
    c, m = out["checks"], out["metrics"]
    return {
        "source": out["source"], "seconds": round(time.perf_counter() - t, 1), "scenarios": len(out["scenarios"]),
        "trees": c["trees"], "low_value_ratio": c["low_value_tree_ratio"], "beside_canopy": c["trees_beside_existing_canopy_ratio"],
        "zones": c["trees_per_zone"], "species": c["trees_by_species"],
        "surface_c": m["temp_reduction_c"], "air_c": m["air_reduction_c"], "equity_c": m["equity_cooling_c"],
        "cost_inr": round(m["total_cost_inr"]), "budget_used_pct": c["budget_used_pct"], "per_degree_inr": m["cost_per_degree_inr"],
        "unverified": out["unverified_numbers"], "refusals": sum(1 for s in out["steps"] if "refus" in (s["action"] + s["detail"]).lower()),
        "headline": out["answer"].get("headline"), "caveats": out["answer"].get("caveats"), "untouched_vulnerable": c["vulnerable_zones_untouched"],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--areas", default=",".join(AREAS))
    ap.add_argument("--briefs", default=",".join(map(str, range(len(BRIEFS)))))
    ap.add_argument("--rules-only", action="store_true")
    a = ap.parse_args()
    llm = None if a.rules_only else gemini.client()
    print(f"planner model: {gemini.PLANNER_MODEL if llm else 'none (rules only)'}")
    results = []
    for key in a.areas.split(","):
        block = load_area(key)
        for i in map(int, a.briefs.split(",")):
            for name, who in (("gemini", llm), ("rules", None)):
                if name == "gemini" and not llm:
                    continue
                try:
                    agent.client = (lambda: llm) if who else (lambda: None)   # plan() asks for the client itself when none is passed
                    r = run(block, BRIEFS[i], BUDGET.get(i, 2_000_000), who)
                except Exception as e:  # noqa: BLE001 - report and carry on
                    r = {"error": repr(e)}
                results.append({"area": key, "brief": BRIEFS[i], "planner": name, **r})
                print(json.dumps(results[-1], ensure_ascii=False))
    ok = [r for r in results if "error" not in r]
    print(f"\n{len(ok)}/{len(results)} runs completed; unverified numbers in {sum(bool(r['unverified']) for r in ok)}; "
          f"plans above the 10% low-value limit: {sum(r['low_value_ratio'] > 0.10 for r in ok)}")


if __name__ == "__main__":
    main()
