"""People per cell from a coarse population raster (WorldPop, ~93 m pixels), split onto buildings.

Spreading a pixel's people evenly over its hundred 10 m cells would claim a precision the data doesn't have: a park would
get the same residents as a tower block. Instead each pixel's people are shared among its cells by building floor area, and
the pixel's total is conserved. Only the area inside the box is shared out, in proportion to how much of the pixel it covers.
"""
import numpy as np
from scipy.ndimage import gaussian_filter

SMOOTH_SIGMA_CELLS = 5   # "residents within ~100 m": a Gaussian with sigma 50 m


def dasymetric(pixel_people: np.ndarray, pixel_of_cell: np.ndarray, floor_m2: np.ndarray, cells_per_pixel: float) -> np.ndarray:
    """People per cell.

    pixel_people     1-D: people in each source pixel
    pixel_of_cell    (rows, cols): index of the source pixel each cell's centre falls in (-1: none)
    floor_m2         (rows, cols): building floor area in each cell
    cells_per_pixel  how many cells a whole pixel holds (pixel area ÷ cell area, about 86)

    A pixel's people are shared among ITS cells by floor area (evenly where it has no buildings). A pixel that lies only
    partly inside the area gives away only that share of its people; one that is (nearly) fully inside gives away all of them.
    """
    idx, floor = pixel_of_cell.ravel(), floor_m2.ravel()
    ok = idx >= 0
    n = len(pixel_people)
    cells_in = np.bincount(idx[ok], minlength=n).astype(float)
    floor_in = np.bincount(idx[ok], weights=floor[ok], minlength=n)
    inside = np.where(cells_in >= 0.9 * cells_per_pixel, 1.0, cells_in / cells_per_pixel)
    p = idx[ok]
    has_floor = floor_in[p] > 0
    weight = np.where(has_floor, floor[ok] / np.where(has_floor, floor_in[p], 1), 1 / np.maximum(cells_in[p], 1))
    out = np.zeros(idx.shape)
    out[ok] = pixel_people[p] * inside[p] * weight
    return out.reshape(pixel_of_cell.shape)


def exposure(vulnerable: np.ndarray) -> np.ndarray:
    """Vulnerable residents within ~100 m of each cell (smoothed), the weight behind 'plan for the people who feel the heat'."""
    return gaussian_filter(vulnerable, SMOOTH_SIGMA_CELLS, mode="constant")
