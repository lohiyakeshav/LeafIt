"""The nine named zones (NW … SE) an area is split into, so a plan can be talked about and steered by place."""
import numpy as np

ZONES = ["NW", "N", "NE", "W", "C", "E", "SW", "S", "SE"]
LABELS = {"NW": "north-west", "N": "north", "NE": "north-east", "W": "west", "C": "centre", "E": "east",
          "SW": "south-west", "S": "south", "SE": "south-east"}


def bounds(rows: int, cols: int) -> dict[str, tuple[int, int, int, int]]:
    """zone -> (row0, row1, col0, col1), splitting the grid into thirds (row 0 is north, col 0 is west)."""
    rs, cs = np.linspace(0, rows, 4).round().astype(int), np.linspace(0, cols, 4).round().astype(int)
    return {z: (int(rs[i // 3]), int(rs[i // 3 + 1]), int(cs[i % 3]), int(cs[i % 3 + 1])) for i, z in enumerate(ZONES)}


def mask(rows: int, cols: int, names) -> np.ndarray:
    m = np.zeros((rows, cols), bool)
    for z in names or ():
        if z in ZONES:
            r0, r1, c0, c1 = bounds(rows, cols)[z]
            m[r0:r1, c0:c1] = True
    return m


def zone_of(r: int, c: int, rows: int, cols: int) -> str:
    for z, (r0, r1, c0, c1) in bounds(rows, cols).items():
        if r0 <= r < r1 and c0 <= c < c1:
            return z
    return "C"
