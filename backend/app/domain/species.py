"""Street-tree catalogue (shared/species.json): what each species means for shade, growth and spacing.

The model only uses three things per species: crown area (shade and cooling scale with it), growth speed (how fast the
effect matures) and spacing (how many fit in a 10 m cell). Everything else in the catalogue is for people and the agent.
"""
import math

import numpy as np

from app.config import MODEL, SPECIES

DEFAULT = SPECIES["default"]
_REF_CROWN_M2 = MODEL["canopy"]["crown_ref_m2"]            # the generic tree's crown: 8 m across = 50 m²
_REF_CROWN_M = SPECIES["size_classes"]["medium"]["crown_m"]
PIT_M2 = SPECIES["pit_m2"]
BY_ID = {s["id"]: s for s in SPECIES["species"]}


def get(species_id: str | None) -> dict:
    """The catalogue entry, or the generic tree for None / an unknown id."""
    return BY_ID.get(species_id or DEFAULT, BY_ID[DEFAULT])


def crown_m(sp: dict) -> float:
    return SPECIES["size_classes"][sp["size_class"]]["crown_m"]


def spacing_m(sp: dict) -> float:
    return SPECIES["size_classes"][sp["size_class"]]["spacing_m"]


def crown_m2(sp: dict) -> float:
    """Mature crown area, scaled from the generic tree (so 'generic' reproduces the original model exactly)."""
    return _REF_CROWN_M2 * (crown_m(sp) / _REF_CROWN_M) ** 2


def crown_ratio(sp: dict) -> float:
    """How many generic trees' worth of shade one mature tree of this species gives."""
    return crown_m2(sp) / _REF_CROWN_M2


def tau_years(sp: dict) -> float:
    return SPECIES["growth_tau_years"][sp["growth"]]


def maturity(sp: dict, years: float) -> float:
    """Share of the species' full effect after `years`: 1 − e^(−years/τ), with τ from its growth speed."""
    return float(1 - np.exp(-max(years, 1) / tau_years(sp)))


def capacity(sp: dict, free_m2: float | np.ndarray, cell_m: float):
    """Trees of this species one cell can take: limited by crown spacing, and by free ground for pits."""
    by_spacing = max(1, math.floor((cell_m / spacing_m(sp)) ** 2))
    return np.minimum(by_spacing, np.floor(np.asarray(free_m2) / PIT_M2)).astype(int)


def suits(sp: dict, climate_class: str | None) -> bool:
    return climate_class is None or climate_class in sp["climates"]

