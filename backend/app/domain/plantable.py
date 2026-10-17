"""Where a tree may go. One ordered rule list, shared by the simulator (to refuse bad plans), the optimiser (to know
where it may buy) and, mirrored in the browser (frontend/src/model/rules.js), the hover ghost.

Order matters and only the FIRST blocking reason is ever reported, so a cell never gets contradictory messages:
carriageway → building/water → already shaded → capacity → humid density.
"""
import numpy as np
from scipy.ndimage import uniform_filter

from app.config import MODEL
from app.domain import species as sp_mod

RULES = MODEL["placement_rules"]["tree"]
CARRIAGEWAY_FROM = MODEL["carriageway_block_from"]
MAX_CANOPY = MODEL["canopy"]["plantable_max_canopy"]
HUMID = MODEL["humid"]


def free_m2(block) -> np.ndarray:
    """Ground in each cell that is neither building, carriageway nor already under canopy."""
    taken = np.clip(block.building_frac + block.carriageway + block.canopy_frac, 0, 1)
    return block.meta["cell_m"] ** 2 * (1 - taken)


def hard_block(block) -> np.ndarray:
    """Cells where no tree may ever go (rules 1 to 3), as a boolean grid."""
    water = np.zeros(block.lst.shape, bool)
    classes = block.meta["landcover_classes"]
    if "water" in classes:
        water = block.landcover == classes.index("water")
    return ((block.carriageway >= CARRIAGEWAY_FROM) | (block.building_frac >= RULES["blocked_building_frac_from"]) | water
            | (block.canopy_frac >= MAX_CANOPY))


def capacity_grid(block, sp: dict) -> np.ndarray:
    """Trees of this species each cell can take (0 where blocked)."""
    cap = sp_mod.capacity(sp, free_m2(block), block.meta["cell_m"])
    return np.where(hard_block(block), 0, cap)


def block_reason(block, sp: dict, r: int, c: int, total_in_cell: int) -> str | None:
    """First reason a cell can't take `total_in_cell` trees of this species, or None. Rules 1 to 4."""
    if block.carriageway[r, c] >= CARRIAGEWAY_FROM:
        return "That's the carriageway: trees go on the footpath edge"
    if block.building_frac[r, c] >= RULES["blocked_building_frac_from"] or block.landcover_name(r, c) in RULES["blocked_landcover"]:
        return "No room for a tree here"
    if block.canopy_frac[r, c] >= MAX_CANOPY:
        return "Already well shaded here"
    free = block.meta["cell_m"] ** 2 * (1 - min(1.0, float(block.building_frac[r, c] + block.carriageway[r, c] + block.canopy_frac[r, c])))
    cap = int(sp_mod.capacity(sp, free, block.meta["cell_m"]))
    if total_in_cell > cap:
        return "Not enough free ground for a tree here" if cap == 0 else f"Only {cap} tree{'s' if cap > 1 else ''} fit{'' if cap > 1 else 's'} here"
    return None


def window_canopy_m2(block, planned_crown_m2: np.ndarray) -> np.ndarray:
    """Crown area in every 3×3-cell window (existing canopy plus planned mature crowns), for the humid-climate rule."""
    n = HUMID["window_cells"]
    crown = block.canopy_frac * block.meta["cell_m"] ** 2 + planned_crown_m2
    return uniform_filter(crown, size=n, mode="constant") * n * n


def humid_limit_m2(block) -> float:
    n = HUMID["window_cells"]
    return HUMID["max_window_canopy"] * (n * block.meta["cell_m"]) ** 2


def humid_violation(block, planned_crown_m2: np.ndarray) -> bool:
    """True if, in a humid climate, planting would pack more than half of any ~30 m window with crown (airflow rule)."""
    if not block.humid or not planned_crown_m2.any():
        return False
    n = HUMID["window_cells"]
    # windows that hold a planned tree: one planted cell adds 1/n² to the mean; "> 0" would also catch the float residue the
    # running-sum filter leaves along the row (measured ~1e-17), flagging windows far from any new tree
    touched = uniform_filter((planned_crown_m2 > 0).astype(float), size=n, mode="constant") > 0.5 / n**2
    return bool((window_canopy_m2(block, planned_crown_m2)[touched] > humid_limit_m2(block) + 1e-6).any())
