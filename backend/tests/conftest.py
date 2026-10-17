"""Shared fixtures. Every test runs offline and isolated:

- saved plans and built areas go to a temporary folder (nothing is written to backend/data),
- Gemini, Google Maps and live exchange rates are switched off, so no test ever calls the network.
"""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import config
from app.domain.sim import simulate
from app.integrations import gemini
from app.main import app
from app.storage.store import store


@pytest.fixture(autouse=True)
def offline(monkeypatch, tmp_path):
    for key in ("GEMINI_API_KEY", "GOOGLE_CLOUD_PROJECT"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(gemini, "_client", None)
    monkeypatch.setattr(config, "GOOGLE_MAPS_SERVER_KEY", None)
    monkeypatch.setattr(config, "ALLOW_SYNTHETIC_AREAS", False)
    monkeypatch.setattr(store, "plans_dir", tmp_path / "plans")
    monkeypatch.setattr(store, "areas_dir", tmp_path / "areas")
    monkeypatch.setattr(store, "_cache", {})   # areas built by one test must not leak into the next


@pytest.fixture
def api():
    return TestClient(app)


@pytest.fixture(scope="session")
def block():
    """The shipped 600 × 600 m sample block: the fixture every simulator test runs on."""
    return store.get_block("demo_lajpat")


class Cells:
    """Handy cells and plans on the sample block."""

    def __init__(self, block):
        self.block = block
        self.open = np.argwhere(block.building_frac < 0.5)
        self.roofs = np.argwhere(block.roof_area > 0)
        self.road = next((int(r), int(c)) for r, c in self.open if block.is_class(r, c, "road"))

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
