"""The pure data steps that turn satellite and map data into the fields the model uses (no network, no Earth Engine)."""
import numpy as np
import pytest

from app.domain.area import canopy_grid, climate, population, roads
from app.domain.area.buildings import floor_area
from app.domain.area.grid import Bounds, make_grid


def small_grid(rows=20, cols=20):
    b = Bounds(28.5722, 28.5704, 77.2420, 77.2402)
    g = make_grid(b)
    return g.__class__(rows, cols, g.cell_m, g.north, g.west, g.dlat, g.dlng)


# ── canopy ───────────────────────────────────────────────────────────────────────────────────────
def test_canopy_cover_and_height_per_cell():
    fine = np.zeros((8, 8))          # 2 × 2 cells, each 4 × 4 pixels
    fine[:2, :4] = 12.0              # half of the top-left cell is 12 m trees
    fine[4:, 4:] = 2.0               # the bottom-right is only shrubs
    frac, h = canopy_grid.aggregate(fine, 4)
    assert frac.tolist() == [[0.5, 0.0], [0.0, 0.0]] and h[0, 0] == 12.0 and h[1, 1] == 0.0


def test_missing_tiles_are_detected_and_fall_back_to_worldcover_flagged():
    fine = np.full((8, 8), np.nan)
    assert canopy_grid.valid_share(fine) == 0.0 and canopy_grid.valid_share(np.zeros((8, 8))) == 1.0
    frac, h = canopy_grid.from_worldcover(np.array([[10, 50], [10, 80]]))
    assert frac.tolist() == [[0.7, 0.0], [0.7, 0.0]] and h[0, 0] == 8.0
    assert canopy_grid.disagreement(np.array([[0.9, 0.0]]), np.array([[50, 50]])) == 0.5


# ── roads ────────────────────────────────────────────────────────────────────────────────────────
def way(g, kind, row=10, tags=None, name="Market Road"):
    lat = g.north - (row + 0.5) * g.dlat
    return {"tags": {"highway": kind, "name": name, **(tags or {})},
            "geometry": [{"lat": lat, "lon": g.west}, {"lat": lat, "lon": g.west + g.cols * g.dlng}]}


def test_width_precedence_tag_then_lanes_then_type_default():
    assert roads.width_m({"highway": "primary", "width": "9.5"}) == 9.5
    assert roads.width_m({"highway": "primary", "width": "9.5 m"}) == 9.5
    assert roads.width_m({"highway": "primary", "lanes": "4"}) == 14.0
    assert roads.width_m({"highway": "primary"}) == 14.0                       # never 0: an untagged highway still blocks trees
    assert roads.width_m({"highway": "primary", "width": "wide"}) == 14.0      # junk tags are ignored
    assert roads.width_m({"highway": "residential"}) == 5.5 and roads.width_m({"highway": "primary_link"}) == 14.0
    assert roads.width_m({"highway": "footway"}) is None and roads.width_m({"highway": "cycleway"}) is None


def test_a_primary_road_is_carriageway_in_its_cells_and_leaves_footpath_edges():
    g = small_grid()
    frac, named = roads.rasterise([way(g, "primary")], g)                       # 14 m wide through the middle of row 10
    assert frac[10].min() > 0.99                                                # the row it runs along is carriageway
    assert 0.1 < frac[9, 5] < 0.5 and 0.1 < frac[11, 5] < 0.5                   # the neighbours hold only the road's edge: footpath
    assert frac[5].max() == 0 and frac[15].max() == 0
    assert named[0]["name"] == "Market Road" and named[0]["width_m"] == 14.0


def test_a_named_road_is_listed_even_when_both_its_ends_lie_outside_the_box():
    g = small_grid()
    long_way = way(g, "secondary")
    long_way["geometry"] = [{"lat": long_way["geometry"][0]["lat"], "lon": g.west - 0.01}, {"lat": long_way["geometry"][0]["lat"], "lon": g.east + 0.01}]
    _, named = roads.rasterise([long_way], g)                                   # what Overpass returns: the whole street
    assert [r["name"] for r in named] == ["Market Road"]
    away = way(g, "secondary", name="Elsewhere")
    away["geometry"] = [{"lat": g.north + 0.05, "lon": g.west}, {"lat": g.north + 0.05, "lon": g.east}]
    assert roads.rasterise([away], g)[1] == []                                  # a street nowhere near is not


def test_footways_and_unknown_ways_are_not_carriageway():
    g = small_grid()
    frac, named = roads.rasterise([way(g, "footway", name="Path"), way(g, "unknown_kind", row=3)], g)
    assert frac.max() == 0 and named == []


# ── population ───────────────────────────────────────────────────────────────────────────────────
def test_people_follow_buildings_and_each_pixel_total_is_kept():
    pix_of = np.zeros((10, 10), int)
    pix_of[:, 5:] = 1                                       # two source pixels, left and right halves
    floor = np.zeros((10, 10))
    floor[0:5, 0:3] = 100.0                                 # buildings only in the top-left of pixel 0
    out = population.dasymetric(np.array([500.0, 200.0]), pix_of, floor, cells_per_pixel=50)
    assert abs(out[:, :5].sum() - 500) < 1e-9 and abs(out[:, 5:].sum() - 200) < 1e-9     # totals conserved
    assert out[0, 0] > 0 and out[9, 4] == 0                                               # people live in buildings, not in the open
    assert np.allclose(out[:, 5:], 200 / 50)                                              # no buildings in pixel 1: shared evenly


def test_a_pixel_only_partly_inside_gives_away_only_its_share():
    pix_of = np.full((5, 5), 0)                              # 25 cells of a pixel that would hold 100
    out = population.dasymetric(np.array([400.0]), pix_of, np.ones((5, 5)), cells_per_pixel=100)
    assert abs(out.sum() - 100) < 1e-9                       # a quarter inside: a quarter of the people


def test_exposure_smooths_vulnerable_residents_over_about_100_m():
    v = np.zeros((41, 41))
    v[20, 20] = 100.0
    e = population.exposure(v)
    assert 0 < e[20, 30] < e[20, 20] and e[20, 20] < 100 and abs(e.sum() - 100) < 1


def test_building_floor_area_counts_storeys():
    g = small_grid()
    sq = lambda h: {"poly": [[20, 20], [40, 20], [40, 40], [20, 40]], "height_m": h}      # noqa: E731
    one, three = floor_area([sq(3.0)], g), floor_area([sq(9.0)], g)
    assert abs(one.sum() - 400) < 1e-6 and abs(three.sum() - 1200) < 1e-6


# ── climate ──────────────────────────────────────────────────────────────────────────────────────
def test_climate_class_comes_from_hot_season_humidity():
    assert [climate.classify(x) for x in (30, 44.9, 45, 55, 65, 70, None)] == ["hot_dry", "hot_dry", "composite", "composite", "composite", "humid", None]
    assert climate.mean_direction([350, 10]) in (0.0, 360.0) and climate.mean_direction([]) is None


@pytest.mark.parametrize("pad", [3, 15])
def test_the_ring_grid_lines_up_with_the_area_grid(pad):
    g = small_grid()
    big = g.padded(pad)
    assert big.cell_of(g.north - 0.5 * g.dlat, g.west + 0.5 * g.dlng) == (pad, pad)       # the area's first cell sits at (pad, pad)
    assert (big.rows, big.cols) == (g.rows + 2 * pad, g.cols + 2 * pad)
    fine = g.refined(4)
    assert (fine.rows, fine.cols, fine.cell_m) == (g.rows * 4, g.cols * 4, g.cell_m / 4)
