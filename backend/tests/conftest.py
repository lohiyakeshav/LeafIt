"""Shared fixtures. Every test runs offline and isolated:

- saved plans and built areas go to a temporary folder (nothing is written to backend/data),
- Gemini, Google Maps and live exchange rates are switched off, so no test ever calls the network.
"""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import config
from app.api.deps import block_repository, plan_repository
from app.domain import plantable
from app.domain import species as species_mod
from app.domain.sim import simulate
from app.integrations import conditions, gemini, osm
from app.main import app


async def _no_osm(ring_grid):
    return {"ways": [], "pois": [], "ok": False}


async def _no_climate(lat, lng):
    return None


@pytest.fixture(autouse=True)
def offline(monkeypatch, tmp_path):
    for key in ("GEMINI_API_KEY", "GOOGLE_CLOUD_PROJECT", "LEAFIT_VERTEX_CREDENTIALS"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(gemini, "_client", None)
    monkeypatch.setattr(config, "GOOGLE_MAPS_SERVER_KEY", None)
    monkeypatch.setattr(osm, "fetch", _no_osm)                       # OpenStreetMap and the weather archive are off too
    monkeypatch.setattr(conditions, "climate_normal", _no_climate)
    monkeypatch.setattr(plan_repository, "plans_dir", tmp_path / "plans")
    monkeypatch.setattr(block_repository, "areas_dir", tmp_path / "areas")
    monkeypatch.setattr(block_repository, "_cache", {})   # areas built by one test must not leak into the next


@pytest.fixture
def api():
    return TestClient(app)


@pytest.fixture(scope="session")
def block():
    """The shipped real sample (Lajpat Nagar Central Market, 700 × 700 m): the fixture every simulator test runs on."""
    return block_repository.get_block("lajpat_nagar")


class Cells:
    """Handy cells and plans on the sample block."""

    def __init__(self, block):
        self.block = block
        # cells that can take a tree under the placement rules (not carriageway, building or already well shaded)
        self.open = np.argwhere((plantable.capacity_grid(block, species_mod.get(None)) >= 1) & (block.building_frac < 0.5))
        self.roofs = np.argwhere(block.roof_area > 0)
        self.road = next((int(r), int(c)) for r, c in np.argwhere(block.building_frac < 0.5) if block.is_class(r, c, "road"))   # for shelters

    def trees(self, n):
        return [{"type": "tree", "row": int(r), "col": int(c)} for r, c in self.open[:n]]

    def mix(self):
        """3 trees, 1 cool roof, 1 shaded bus stop."""
        r, c = map(int, self.roofs[0])
        return self.trees(3) + [{"type": "cool_roof", "row": r, "col": c},
                                {"type": "shade_stop", "row": self.road[0], "col": self.road[1]}]

    def metrics(self, placements, **kw):
        return simulate(self.block, placements, **kw)["metrics"]


@pytest.fixture(scope="session")
def cells(block):
    return Cells(block)
