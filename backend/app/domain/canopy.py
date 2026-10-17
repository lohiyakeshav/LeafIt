"""Shade that already exists, inside the area and in the 150 m ring around it.

The satellite baseline (land-surface temperature) already contains today's trees, so a new tree only adds what the
existing shade has not already removed. For each place we keep the "raw" cooling exposure of what is already there;
the simulator and optimiser then use the marginal form  cap·e^(−existing/cap)·(1 − e^(−new/cap)).
"""
import numpy as np
from scipy.ndimage import convolve

from app.config import MODEL

CANOPY = MODEL["canopy"]
AIR = MODEL["air"]
COOLING_CAP_C = MODEL["cooling_cap_c"]


def kernel(sigma: float) -> np.ndarray:
    rad = int(np.ceil(3 * sigma))
    y, x = np.mgrid[-rad:rad + 1, -rad:rad + 1]
    return np.exp(-(x**2 + y**2) / (2 * sigma**2))  # peak 1 at the tree's own cell


def shade_weight(height_m: np.ndarray) -> np.ndarray:
    """How much of a canopy's cover counts as tree shade: nothing below 2 m (shrubs), everything from 8 m (a street tree)."""
    lo, hi = CANOPY["min_height_m"], CANOPY["full_height_m"]
    return np.clip((height_m - lo) / (hi - lo), 0, 1)


def tree_equivalents(canopy_frac: np.ndarray, canopy_h: np.ndarray, cell_m: float) -> np.ndarray:
    """Existing canopy as 'generic mature trees' per cell: crown area ÷ one tree's 50 m², weighted by height."""
    return canopy_frac * cell_m**2 / CANOPY["crown_ref_m2"] * shade_weight(canopy_h)


def existing_raw(equiv: np.ndarray, ring_equiv: np.ndarray | None, pad: int, kernels: dict, tree_cool_c: float):
    """(surface, air) raw cooling exposure from existing trees at every cell of the area.

    `ring_equiv` is the same quantity over the area plus `pad` cells all round (the area sits in its middle), so trees
    just outside the box cool its edges. Without a ring the outside counts as bare.
    """
    rows, cols = equiv.shape
    if ring_equiv is None:
        pad = max(k.shape[0] // 2 for k in kernels.values())
        ring_equiv = np.pad(equiv, pad)
    out = []
    for key, weight in (("surface", tree_cool_c), ("air", AIR["per_tree_c"])):
        full = weight * convolve(ring_equiv, kernels[key], mode="constant")
        out.append(full[pad:pad + rows, pad:pad + cols])
    return tuple(out)


def marginal(existing: np.ndarray, new: np.ndarray, cap: float) -> np.ndarray:
    """Extra cooling from `new` on top of `existing`, both as raw exposure: saturating, so shade beside shade adds little."""
    return cap * np.exp(-existing / cap) * (1 - np.exp(-new / cap))
