"""Areas built from satellite data: size limits, grid maths, footprints, the build pipeline with Earth Engine faked,
and the HTTP flow (caching, 503 when Earth Engine is down, the dev-only synthetic stand-in and its self-healing)."""
import asyncio

import numpy as np
import pytest

from app import config
from app.api.deps import block_repository
from app.domain.area.buildings import coverage
from app.domain.area.grid import Bounds, area_id, classify, make_grid, validate
from app.domain.sim import simulate
from app.integrations import conditions, earthengine, places
from app.services import area_builder


def box(lat, lng, w_m, h_m):
    dlat, dlng = h_m / 111_320, w_m / (111_320 * np.cos(np.radians(lat)))
    return Bounds(lat + dlat / 2, lat - dlat / 2, lng + dlng / 2, lng - dlng / 2)


def fake_layers(bounds, grid):
    """Five 20 × 20 m buildings in a row, uniform 44 °C, all built-up land cover."""
    def ring(i):
        x0, x1, z0, z1 = grid.west + (4 + 3 * i) * grid.dlng, grid.west + (6 + 3 * i) * grid.dlng, grid.north - 10 * grid.dlat, grid.north - 12 * grid.dlat
        return [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]]
    feats = [{"properties": {"full_plus_code": f"X{i}"}, "geometry": {"type": "Polygon", "coordinates": [ring(i)]}} for i in range(5)]
    return {"lst": np.full((grid.rows, grid.cols), 44.0), "worldcover": np.full((grid.rows, grid.cols), 50), "features": feats,
            "height_at": lambda la, ln: 12.0, "lst_period": "test"}


async def fake_conditions(la, ln):
    return {"air_temp_c": 38.0, "feels_like_c": 41.0, "humidity_pct": 30, "aqi": 212, "aqi_source": "test", "fetched_at": 0}


def ee_down(bounds, grid):
    raise earthengine.EEUnavailable("The satellite data service isn't reachable right now.")


@pytest.fixture
def fake_earth(monkeypatch):
    monkeypatch.setattr(earthengine, "fetch_layers", fake_layers)
    monkeypatch.setattr(conditions, "fetch", fake_conditions)


# ---- pure geometry ---------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("w, h, word", [(150, 700, "too small"), (1200, 1200, "too large"), (1600, 200, "too large")])
def test_size_limits(w, h, word):
    validate(box(28.57, 77.24, 700, 700))                    # 0.49 km² fine
    validate(box(28.57, 77.24, 1000, 1000))                  # right at the 1 km² cap
    with pytest.raises(ValueError, match=word):
        validate(box(28.57, 77.24, w, h))
    with pytest.raises(ValueError, match="not valid"):
        validate(Bounds(1, 2, 3, 4))


def test_area_id_is_stable_per_box():
    assert area_id(box(28.57, 77.24, 700, 700)) == area_id(box(28.57, 77.24, 700, 700)) != area_id(box(28.58, 77.24, 700, 700))


def test_grid_maths():
    g = make_grid(box(28.57, 77.24, 700, 500))
    assert (g.rows, g.cols) == (50, 70) and g.cell_of(g.north - 1e-9, g.west + 1e-9) == (0, 0) and g.cell_of(g.south - 0.01, g.west) is None
    lat, lng = g.north - 25.5 * g.dlat, g.west + 40.5 * g.dlng
    assert g.cell_of(lat, lng) == (25, 40) and all(abs(v - e) < 1e-6 for v, e in zip(g.to_local_m(lat, lng), (405, 255), strict=True))


def test_footprint_coverage():
    g = make_grid(box(28.57, 77.24, 700, 500))
    sq = lambda x, z, s: {"id": f"s{x}{z}", "area_m2": s * s, "height_m": 9.0, "poly": [[x, z], [x + s, z], [x + s, z + s], [x, z + s]]}
    cov = coverage([sq(20, 20, 20), sq(0, 0, 5), sq(20, 20, 10)], g)   # overlaps count once
    assert cov[2:4, 2:4].min() == 1 and cov[0, 0] == 0.25 and abs(cov.sum() - 4.25) < 1e-6
    tri = coverage([{"poly": [[13.3, 13.3], [37.7, 13.3], [25, 41.1]]}], g)   # true area 339.2 m²
    assert abs(tri.sum() * 100 - 339.2) < 14


def test_land_cover_classes():
    cls = classify(np.array([[50, 50, 10, 80, 30]]), np.array([[0.0, 0.9, 0.0, 0.0, 0.0]]))
    assert cls.tolist() == [[1, 0, 2, 5, 3]]                 # road, built, tree, water, grass


def test_heat_gaps_are_filled_and_all_gaps_fail():
    lst = np.full((20, 20), 40.0)
    lst[5:9, 5:9] = np.nan
    assert np.isfinite(earthengine.fill_gaps(lst)).all() and abs(earthengine.fill_gaps(lst)[6, 6] - 40) < 0.01
    with pytest.raises(earthengine.EEUnavailable):
        earthengine.fill_gaps(np.full((5, 5), np.nan))
    assert earthengine.hot_months(28.6) == (4, 6) and earthengine.hot_months(-33) == (12, 2)


def test_landmarks_are_picked_inside_the_grid():
    g = make_grid(box(28.57, 77.24, 700, 500))
    lat, lng = g.north - 25.5 * g.dlat, g.west + 40.5 * g.dlng
    lms = places.pick([{"displayName": {"text": "A"}, "types": ["school"], "location": {"latitude": lat, "longitude": lng}},
                       {"displayName": {"text": "Far"}, "types": ["school"], "location": {"latitude": 0, "longitude": 0}},
                       {"displayName": {"text": "P"}, "types": ["park"], "location": {"latitude": lat, "longitude": lng}}], g)
    assert [(x["name"], x["kind"], x["row"], x["col"]) for x in lms] == [("A", "school", 25, 40), ("P", "park", 25, 40)]


# ---- the build pipeline ----------------------------------------------------------------------------------------------
def test_pipeline_assembles_a_real_block(fake_earth):
    area = asyncio.run(area_builder.build_area(box(28.57, 77.24, 600, 400), "Test area"))
    assert area["synthetic"] is False and area["source"] == "earth_engine" and area["baseline_aqi"] == 212
    assert (area["rows"], area["cols"]) == (40, 60) and len(area["buildings"]) == 5 and area["buildings"][0]["height_m"] == 12.0
    assert max(map(max, area["building_frac"])) == 1.0 and area["landcover"][10][4] == 0 and area["landcover"][0][0] == 1
    block_repository.save_area(area)
    block = block_repository.get_block(area["id"])
    out = simulate(block, [{"type": "tree", "row": 0, "col": 0}, {"type": "cool_roof", "row": 10, "col": 4}], 10)
    assert out["metrics"]["total_cost_inr"] == 3000 + round(float(block.roof_area[10, 4]) * 250) and len(out["cooling_grid"]) == 40


# ---- over HTTP -------------------------------------------------------------------------------------------------------
GOOD = box(28.57, 77.24, 700, 500)
BODY = {"bounds": {"north": GOOD.north, "south": GOOD.south, "east": GOOD.east, "west": GOOD.west}, "name": "Lajpat"}


def test_built_areas_are_cached_and_immutable(api, fake_earth):
    r = api.post("/areas", json=BODY).json()
    assert r["cached"] is False and api.post("/areas", json=BODY).json() == {"id": r["id"], "cached": True}
    got = api.get(f"/areas/{r['id']}")
    assert got.json()["kind"] == "area" and "immutable" in got.headers["cache-control"] and api.get("/areas/nope").status_code == 404
    assert api.get(f"/blocks/{r['id']}").status_code == 200 and r["id"] not in [x["id"] for x in api.get("/blocks").json()]
    assert api.post("/simulate", json={"block_id": r["id"], "placements": [{"type": "tree", "row": 3, "col": 3}]}).status_code == 200


def test_out_of_range_boxes_are_readable_422s(api):
    assert "too large" in api.post("/areas", json={"bounds": {"north": 28.6, "south": 28.5, "east": 77.3, "west": 77.2}}).json()["detail"]
    assert api.post("/areas", json={"bounds": {"north": 99, "south": 0, "east": 1, "west": 0}}).json()["detail"] == "The area's corners must be real map coordinates."


def test_earth_engine_down_is_503_unless_synthetic_is_allowed_then_heals(api, monkeypatch):
    monkeypatch.setattr(conditions, "fetch", fake_conditions)
    monkeypatch.setattr(earthengine, "fetch_layers", ee_down)
    assert api.post("/areas", json=BODY).status_code == 503

    monkeypatch.setattr(config, "ALLOW_SYNTHETIC_AREAS", True)
    syn = api.post("/areas", json=BODY).json()
    sb = api.get(f"/areas/{syn['id']}")
    assert sb.json()["synthetic"] is True and "synthetic" in sb.json()["name"] and sb.headers["cache-control"] == "no-cache"
    assert api.post("/simulate", json={"block_id": syn["id"], "placements": []}).status_code == 200
    rec = api.post("/agent", json={"block_id": syn["id"], "budget_inr": 500_000, "brief": "cool the hottest streets"}).json()
    assert rec["metrics"]["total_cost_inr"] <= 500_000 and rec["placements"]   # the planner works without landmarks

    monkeypatch.setattr(earthengine, "fetch_layers", fake_layers)            # Earth Engine is back: same box, real data
    assert api.post("/areas", json=BODY).json() == {"id": syn["id"], "cached": False}
    healed = api.get(f"/areas/{syn['id']}")
    assert healed.json()["synthetic"] is False and "immutable" in healed.headers["cache-control"]
    assert api.post("/areas", json=BODY).json()["cached"] is True
