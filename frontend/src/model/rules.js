// The cooling model's numbers and placement rules. Read from shared/model.json and shared/species.json, the SAME files the
// Python simulator uses, so the browser and the server can't drift apart (model/sim.test.js replays golden cases).
import MODEL from '@shared/model.json';
import SPECIES from '@shared/species.json';

export { MODEL, SPECIES };
export const TYPES = MODEL.types;
export const RULES = MODEL.placement_rules;
export const AREA = MODEL.area;
export const AIR = MODEL.air;
export const CANOPY = MODEL.canopy;
export const HUMID = MODEL.humid;

export const maturity = (years) => 1 - Math.exp(-Math.max(years, 1) / MODEL.tree.growth_tau_years);

/** Python-style rounding helper (half-up; ties are vanishingly rare with float data). */
export const round = (x, digits = 0) => {
  const m = 10 ** digits;
  return Math.round(x * m) / m;
};

// ── species: crown area, growth speed and spacing are all the model uses ─────────────────────────
export const SPECIES_BY_ID = Object.fromEntries(SPECIES.species.map((s) => [s.id, s]));
export const speciesOf = (id) => SPECIES_BY_ID[id || SPECIES.default] ?? SPECIES_BY_ID[SPECIES.default];
const cls = (sp) => SPECIES.size_classes[sp.size_class];
const REF_CROWN_M = SPECIES.size_classes.medium.crown_m;
export const crownM2 = (sp) => CANOPY.crown_ref_m2 * (cls(sp).crown_m / REF_CROWN_M) ** 2;
export const crownRatio = (sp) => crownM2(sp) / CANOPY.crown_ref_m2;
export const spacingM = (sp) => cls(sp).spacing_m;
export const speciesMaturity = (sp, years) => 1 - Math.exp(-Math.max(years, 1) / SPECIES.growth_tau_years[sp.growth]);
export const suits = (sp, climate) => !climate || sp.climates.includes(climate);
/** Trees one cell can take: limited by crown spacing and by free ground for pits. */
export const capacityOf = (sp, freeM2, cellM) => Math.min(Math.max(1, Math.floor((cellM / spacingM(sp)) ** 2)), Math.floor(freeM2 / SPECIES.pit_m2));

// ── where a tree may go: one ordered list, only the first blocking reason is reported ───────────────
const TREE = RULES.tree;

/** Ground in cell i that is neither building, carriageway nor under canopy (m²). */
export const freeM2 = (grid, i) => grid.cellM ** 2 * (1 - Math.min(1, grid.bf[i] + grid.carriageway[i] + grid.canopy[i]));

/** First reason cell (row, col) can't take `total` trees of species `sp`, or null. Same order as plantable.block_reason. */
export function treeBlockReason(grid, sp, row, col, total = 1) {
  const i = row * grid.cols + col;
  if (grid.carriageway[i] >= MODEL.carriageway_block_from) return "That's the carriageway: trees go on the footpath edge";
  if (grid.bf[i] >= TREE.blocked_building_frac_from || TREE.blocked_landcover.includes(grid.classes[grid.lc[i]])) return 'No room for a tree here';
  if (grid.canopy[i] >= CANOPY.plantable_max_canopy) return 'Already well shaded here';
  const cap = capacityOf(sp, freeM2(grid, i), grid.cellM);
  if (total > cap) return cap === 0 ? 'Not enough free ground for a tree here' : `Only ${cap} tree${cap > 1 ? 's' : ''} fit${cap > 1 ? '' : 's'} here`;
  return null;
}

export const humidLimitM2 = (cellM) => HUMID.max_window_canopy * (HUMID.window_cells * cellM) ** 2;

/** Sum over every 3×3 window of a per-cell grid (zero outside the area), as scipy's uniform_filter × 9. */
export function windowSums(grid, values) {
  const { rows, cols } = grid;
  const out = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let s = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) s += values[rr * cols + cc];
      }
      out[r * cols + c] = s;
    }
  }
  return out;
}

/** True if, in a humid climate, the planned mature crowns (m² per cell) fill more than half of any ~30 m window that holds one. */
export function humidViolation(grid, planned) {
  if (!grid.humid) return false;
  const existing = Float64Array.from(grid.canopy, (v) => v * grid.cellM ** 2);
  const crown = existing.map((v, i) => v + planned[i]);
  const touched = windowSums(grid, planned), sums = windowSums(grid, crown), limit = humidLimitM2(grid.cellM);
  for (let i = 0; i < sums.length; i++) if (touched[i] > 0 && sums[i] > limit + 1e-6) return true;
  return false;
}

/**
 * The humid rule for ONE new tree of `addM2` crown at (row, col), given the plan's crowns `planned` (which already pass).
 * Only the 3×3 windows that hold (row, col) can change, so only those are summed: O(1) per hover instead of O(grid).
 * Same result as humidViolation on the plan plus that tree.
 */
export function humidViolationAt(grid, planned, row, col, addM2) {
  if (!grid.humid) return false;
  const { rows, cols, cellM } = grid, limit = humidLimitM2(cellM);
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = col - 1; c <= col + 1; c++) {
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      let s = addM2;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) s += grid.canopy[rr * cols + cc] * cellM * cellM + planned[rr * cols + cc];
      }
      if (s > limit + 1e-6) return true;
    }
  }
  return false;
}

/**
 * Why a placement isn't allowed at (row, col), or null if it is. Same rules as sim.py's _validate; the UI uses it for the
 * red/green hover ghost and the toast, the simulators use it to refuse bad plans.
 * `taken` is a Set of "type:row:col" for items that may only be placed once per cell; for trees, `total` is how many
 * trees the cell would then hold and `species` is the species id.
 */
export function whyNot(grid, type, row, col, taken, { total = 1, species } = {}) {
  if (row < 0 || col < 0 || row >= grid.rows || col >= grid.cols) return 'Outside the selected area';
  const i = row * grid.cols + col;
  const rule = RULES[type];
  if (type === 'tree') return treeBlockReason(grid, speciesOf(species), row, col, total);
  if (rule.unique_per_cell && taken?.has(`${type}:${row}:${col}`)) return type === 'cool_roof' ? 'Roof already coated' : 'Bus stop already here';
  if (rule.requires_roof && grid.roof[i] <= 0) return 'No roof in this cell';
  if (rule.allowed_landcover && !rule.allowed_landcover.includes(grid.classes[grid.lc[i]])) return 'Bus stops go on roads';
  return null;
}
