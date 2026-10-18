"""Areas built from satellite data: size limits, grid maths, footprints, the build pipeline with Earth Engine faked,
and the HTTP flow (caching, 503 when Earth Engine is down, and areas built without OpenStreetMap being rebuilt)."""
import asyncio
import json

import numpy as np
import pytest

from app.api.deps import block_repository
from app.domain.area.buildings import coverage
from app.domain.area.grid import Bounds, area_id, classify, make_grid, validate
from app.domain.sim import Block, simulate
from app.integrations import conditions, earthengine, osm, places
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


def roads_up(monkeypatch):
    """OpenStreetMap answers (one street): an area built with it is final, one built without it is retried."""
    async def osm_data(ring_grid):
        return {"ok": True, "ways": [street_way(ring_grid, 25)], "pois": []}
    monkeypatch.setattr(osm, "fetch", osm_data)


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
    assert area["source"] == "earth_engine" and area["baseline_aqi"] == 212 and "synthetic" not in area
    assert (area["rows"], area["cols"]) == (40, 60) and len(area["buildings"]) == 5 and area["buildings"][0]["height_m"] == 12.0
    assert max(map(max, area["building_frac"])) == 1.0 and area["landcover"][10][4] == 0 and area["landcover"][0][0] == 1
    block_repository.save_area(area)
    block = block_repository.get_block(area["id"])
    out = simulate(block, [{"type": "tree", "row": 0, "col": 0}, {"type": "cool_roof", "row": 10, "col": 4}], 10)
    assert out["metrics"]["total_cost_inr"] == 3000 + round(float(block.roof_area[10, 4]) * 300) and len(out["cooling_grid"]) == 40


# ---- over HTTP -------------------------------------------------------------------------------------------------------
GOOD = box(28.57, 77.24, 700, 500)
BODY = {"bounds": {"north": GOOD.north, "south": GOOD.south, "east": GOOD.east, "west": GOOD.west}, "name": "Lajpat"}


def test_built_areas_are_cached_and_immutable(api, fake_earth, monkeypatch):
    roads_up(monkeypatch)
    r = api.post("/areas", json=BODY).json()
    assert r["cached"] is False and api.post("/areas", json=BODY).json() == {"id": r["id"], "cached": True}
    got = api.get(f"/areas/{r['id']}")
    assert got.json()["kind"] == "area" and "immutable" in got.headers["cache-control"] and api.get("/areas/nope").status_code == 404
    assert api.get(f"/blocks/{r['id']}").status_code == 200 and r["id"] not in [x["id"] for x in api.get("/blocks").json()]
    assert api.post("/simulate", json={"block_id": r["id"], "placements": [{"type": "tree", "row": 3, "col": 3}]}).status_code == 200


def test_out_of_range_boxes_are_readable_422s(api):
    assert "too large" in api.post("/areas", json={"bounds": {"north": 28.6, "south": 28.5, "east": 77.3, "west": 77.2}}).json()["detail"]
    assert api.post("/areas", json={"bounds": {"north": 99, "south": 0, "east": 1, "west": 0}}).json()["detail"] == "The area's corners must be real map coordinates."


def test_earth_engine_down_is_503_never_made_up_data_and_the_area_builds_once_it_is_back(api, monkeypatch):
    monkeypatch.setattr(conditions, "fetch", fake_conditions)
    monkeypatch.setattr(earthengine, "fetch_layers", ee_down)
    assert api.post("/areas", json=BODY).status_code == 503                 # no stand-in: an error, never invented data

    monkeypatch.setattr(earthengine, "fetch_layers", fake_layers)            # Earth Engine is back: same box, real data
    first = api.post("/areas", json=BODY).json()                           # but OpenStreetMap is still off (conftest)
    assert first["cached"] is False and api.get(f"/areas/{first['id']}").headers["cache-control"] == "no-cache"   # provisional
    roads_up(monkeypatch)
    assert api.post("/areas", json=BODY).json() == {"id": first["id"], "cached": False}                         # rebuilt with roads
    assert "immutable" in api.get(f"/areas/{first['id']}").headers["cache-control"]
    assert api.post("/areas", json=BODY).json()["cached"] is True


# ---- the v2 fields: canopy, ring, roads, people, climate -------------------------------------------------------------
def rich_layers(bounds, grid):
    """fake_layers plus what the real fetch adds: a tree belt in the ring north of the box, and a coarse population raster."""
    pad = earthengine.RING_CELLS
    R, C = grid.rows + 2 * pad, grid.cols + 2 * pad
    fine = np.zeros((R * earthengine.CANOPY_SUBSAMPLE, C * earthengine.CANOPY_SUBSAMPLE))
    fine[:pad * earthengine.CANOPY_SUBSAMPLE, :] = 12.0                     # every pixel north of the box is 12 m trees
    return {**fake_layers(bounds, grid),
            "ring": {"pad": pad, "lst": np.full((R, C), 44.0), "worldcover": np.full((R, C), 50), "canopy_fine": fine},
            "pop": {"people": np.full((8, 8), 400.0), "vulnerable": np.full((8, 8), 60.0), "x0": grid.west - 0.0004,
                    "y0": grid.north + 0.0004, "d": 0.0008333}}


def street_way(grid, row, kind="primary", **tags):
    lat = grid.north - (row + 0.5) * grid.dlat
    return {"tags": {"highway": kind, "name": "Market Road", **tags},
            "geometry": [{"lat": lat, "lon": grid.west - 0.001}, {"lat": lat, "lon": grid.east + 0.001}]}


@pytest.fixture
def rich_earth(monkeypatch):
    async def osm_data(ring_grid):
        return {"ok": True, "ways": [street_way(ring_grid, 15 + 10)], "pois": [
            {"lat": ring_grid.north - 30.5 * ring_grid.dlat, "lon": ring_grid.west + 30.5 * ring_grid.dlng, "tags": {"amenity": "school", "name": "City School"}}]}

    async def climate(lat, lng):
        return {"class": "humid", "rh_pct": 72.0, "tmax_hot_c": 35.0, "wind_ms": 3.1, "wind_dir_deg": 225.0, "months": [4, 6], "years": "2023-2026"}
    monkeypatch.setattr(earthengine, "fetch_layers", rich_layers)
    monkeypatch.setattr(conditions, "fetch", fake_conditions)
    monkeypatch.setattr(osm, "fetch", osm_data)
    monkeypatch.setattr(conditions, "climate_normal", climate)


def test_v2_area_carries_canopy_ring_roads_people_and_climate(rich_earth):
    area = asyncio.run(area_builder.build_area(box(28.57, 77.24, 600, 400), "Test area"))
    pad = earthengine.RING_CELLS
    assert area["schema_version"] == 2 and area["canopy_source"] == "meta_wri" and area["roads_source"] == "osm"
    assert max(map(max, area["canopy_frac"])) == 0                                        # the tree belt is outside the box...
    ring = area["ring"]
    assert ring["pad"] == pad and len(ring["canopy_frac"]) == 40 + 2 * pad and ring["canopy_frac"][0][5] == 1.0   # ...but in the ring
    assert ring["canopy_h"][0][5] == 12.0 and len(ring["lst_c"]) == len(ring["landcover"]) == len(ring["carriageway_frac"]) == 40 + 2 * pad
    cw = np.array(area["carriageway_frac"])
    assert cw[10].min() > 0.99 and cw[0].max() == 0 and (np.array(area["landcover"])[10, 30:] == 1).all()   # where no building stands, the road row is "road"
    assert area["roads"][0]["name"] == "Market Road" and area["roads"][0]["width_m"] == 14.0
    assert area["climate"]["class"] == "humid" and area["landmarks"] == [{"name": "City School", "kind": "school", "row": 15, "col": 15}]
    pop, vuln = np.array(area["population"]), np.array(area["vulnerable"])
    assert 0 < pop.sum() <= 400 * 64 and 0 < vuln.sum() < pop.sum() and area["population_total"] == round(float(pop.sum()))
    assert np.array(area["exposure"]).max() > 0
    assert pop[10, 4:6].max() > pop[0, 0]                                                 # more people where the buildings are


def test_a_v2_area_loads_and_simulates_with_ring_roads_and_exposure(rich_earth):
    area = asyncio.run(area_builder.build_area(box(28.57, 77.24, 600, 400), "Test area"))
    block = Block.from_dict(area)
    assert block.humid and block.ring["pad"] == earthengine.RING_CELLS and block.exposure.max() > 0
    assert block.carriageway[10].min() > 0.99
    with pytest.raises(ValueError, match="carriageway"):
        simulate(block, [{"type": "tree", "row": 10, "col": 20}])                         # no trees on the road
    edge = {"type": "tree", "row": 0, "col": 5}
    plain = Block.from_dict({k: v for k, v in area.items() if k != "ring"})
    assert simulate(block, [edge])["metrics"]["peak_reduction_c"] < simulate(plain, [edge])["metrics"]["peak_reduction_c"]   # ring park


def test_optional_layers_failing_never_fail_the_build(monkeypatch):
    def thin(bounds, grid):
        out = rich_layers(bounds, grid)
        out["ring"]["canopy_fine"], out["pop"] = None, None                                # canopy tiles and WorldPop both down
        return out
    monkeypatch.setattr(earthengine, "fetch_layers", thin)
    monkeypatch.setattr(conditions, "fetch", fake_conditions)
    area = asyncio.run(area_builder.build_area(box(28.57, 77.24, 600, 400), "Test area"))
    assert area["canopy_source"] == "worldcover" and area["roads_source"] == "landcover" and area["population_source"] is None
    assert "population" not in area and "exposure" not in area and area["climate"] == {"class": None}
    block = Block.from_dict(area)
    assert simulate(block, [])["metrics"]["equity_cooling_c"] is None                      # no population: no equity number


def test_canopy_gaps_fall_back_to_worldcover_and_say_so():
    g = make_grid(box(28.57, 77.24, 600, 400))
    pad = earthengine.RING_CELLS
    wc = np.full((g.rows + 2 * pad, g.cols + 2 * pad), 50)
    wc[pad + 3, pad + 3] = 10                                                              # one WorldCover tree cell
    k = earthengine.CANOPY_SUBSAMPLE
    gappy = np.full((wc.shape[0] * k, wc.shape[1] * k), np.nan)                            # all tiles missing
    frac, height, source, _ = area_builder.canopy_layers({"worldcover": wc, "canopy_fine": gappy}, pad, g)
    assert source == "worldcover" and frac[pad + 3, pad + 3] == 0.7 and height[pad + 3, pad + 3] == 8.0
    assert area_builder.canopy_layers(None, pad, g)[2] == "none"


def test_areas_built_by_an_older_version_are_rebuilt_not_trusted(api, rich_earth):
    first = api.post("/areas", json=BODY).json()
    old = json.loads(block_repository.get_raw_block(first["id"]))
    old.pop("schema_version")                                                              # what a v1 area looks like on disk
    block_repository.save_area(old)
    assert api.post("/areas", json=BODY).json() == {"id": first["id"], "cached": False}    # rebuilt...
    assert api.post("/areas", json=BODY).json()["cached"] is True                           # ...then cached again


def test_osm_landmarks_pick_places_inside_the_area_bus_stops_first_even_unnamed():
    g = make_grid(box(28.57, 77.24, 700, 500))
    at = lambda r, c: {"lat": g.north - (r + 0.5) * g.dlat, "lon": g.west + (c + 0.5) * g.dlng}   # noqa: E731
    pois = [{**at(5, 5), "tags": {"amenity": "school", "name": "A"}}, {**at(6, 6), "tags": {"highway": "bus_stop", "name": "B"}},
            {"center": at(7, 7), "tags": {"amenity": "hospital", "name": "C"}}, {**at(8, 8), "tags": {"amenity": "school"}},
            {"lat": 0, "lon": 0, "tags": {"amenity": "school", "name": "Far"}}, {**at(20, 20), "tags": {"highway": "bus_stop", "ref": "742"}}]
    assert [(x["name"], x["kind"]) for x in osm.landmarks(pois, g)] == [("B", "bus stop"), ("Bus stop (742)", "bus stop"), ("A", "school"), ("C", "clinic")]


def test_an_area_built_while_overpass_was_down_is_rebuilt_with_roads(api, fake_earth, monkeypatch):
    roads_up(monkeypatch)
    async def down(ring_grid):
        return {"ok": False, "ways": [], "pois": []}
    with monkeypatch.context() as m:
        m.setattr(osm, "fetch", down)
        first = api.post("/areas", json=BODY).json()
        assert api.post("/areas", json=BODY).json() == {"id": first["id"], "cached": False}   # still provisional: roads were guessed
    assert api.post("/areas", json=BODY).json()["cached"] is False                              # rebuilt with real roads ...
    assert api.post("/areas", json=BODY).json()["cached"] is True                               # ... and now final
