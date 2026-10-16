// The cooling model's numbers and placement rules. Read from shared/model.json, the SAME file the Python
// simulator uses, so the browser and the server can't drift apart (see model/sim.test.js, which replays golden cases).
import MODEL from '@shared/model.json';

export { MODEL };
export const TYPES = MODEL.types;
export const RULES = MODEL.placement_rules;
export const AREA = MODEL.area;

export const maturity = (years) => 1 - Math.exp(-Math.max(years, 1) / MODEL.tree.growth_tau_years);

/** Python-style rounding helper (half-up; ties are vanishingly rare with float data). */
export const round = (x, digits = 0) => {
  const m = 10 ** digits;
  return Math.round(x * m) / m;
};

/**
 * Why a placement isn't allowed at (row, col), or null if it is. Same rules as sim.py's _validate; the UI uses it
 * for the red/green hover ghost and the toast, the simulators use it to refuse bad plans.
 * `taken` is a Set of "type:row:col" for items that may only be placed once per cell.
 */
export function whyNot(grid, type, row, col, taken) {
  if (row < 0 || col < 0 || row >= grid.rows || col >= grid.cols) return 'Outside the selected area';
  const i = row * grid.cols + col;
  const cls = grid.classes[grid.lc[i]];
  const rule = RULES[type];
  if (type === 'tree') {
    if (grid.bf[i] >= rule.blocked_building_frac_from || rule.blocked_landcover.includes(cls)) return 'No room for a tree here';
    return null;
  }
  if (rule.unique_per_cell && taken?.has(`${type}:${row}:${col}`)) return type === 'cool_roof' ? 'Roof already coated' : 'Bus stop already here';
  if (rule.requires_roof && grid.roof[i] <= 0) return 'No roof in this cell';
  if (rule.allowed_landcover && !rule.allowed_landcover.includes(cls)) return 'Bus stops go on roads';
  return null;
}
