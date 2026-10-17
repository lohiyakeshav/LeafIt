"""Existing tree canopy per 10 m cell, from a fine canopy-height raster (Meta/WRI 1 m height, sampled at 2.5 m)."""
import numpy as np

TREE_MIN_M = 3.0   # pixels at least this tall count as tree canopy (lower is shrub or grass)


def aggregate(heights: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """(canopy_frac, canopy_h) per cell from a raster that is k × k times finer than the grid.

    canopy_frac is the share of the cell's pixels at least TREE_MIN_M tall; canopy_h is the mean height of those pixels.
    NaN pixels (no data) count as no canopy.
    """
    h = np.nan_to_num(heights, nan=0.0)
    rows, cols = h.shape[0] // k, h.shape[1] // k
    blocks = h[:rows * k, :cols * k].reshape(rows, k, cols, k)
    tall = blocks >= TREE_MIN_M
    frac = tall.mean(axis=(1, 3))
    total = np.where(tall, blocks, 0.0).sum(axis=(1, 3))
    height = np.divide(total, tall.sum(axis=(1, 3)), out=np.zeros_like(total), where=tall.any(axis=(1, 3)))
    return frac, height


def valid_share(heights: np.ndarray) -> float:
    """Share of the raster that has data at all (a tile gap shows up as NaN)."""
    return float(np.isfinite(heights).mean()) if heights.size else 0.0


def from_worldcover(worldcover: np.ndarray, tree_class: int = 10) -> tuple[np.ndarray, np.ndarray]:
    """Fallback when the canopy-height tiles have gaps: WorldCover's tree class as canopy, at an assumed 8 m (flagged as such)."""
    trees = worldcover == tree_class
    return np.where(trees, 0.7, 0.0), np.where(trees, 8.0, 0.0)


def disagreement(frac: np.ndarray, worldcover: np.ndarray, tree_class: int = 10) -> float:
    """Share of cells where canopy height says 'mostly trees' and WorldCover says 'not trees' or the reverse (a data-age hint)."""
    a, b = frac >= 0.5, worldcover == tree_class
    return float((a != b).mean())
