// Browser port of backend/app/domain/sim.py: same formulas, same numbers (shared/model.json), no network.
// It gives instant feedback while the user paints trees; the server's /simulate stays the canonical result
// (Review, saved plans, agent). sim.test.js replays shared/fixtures/golden.json so the two cannot drift.
import { MODEL, TYPES, RULES, maturity, round, whyNot } from './rules.js';

const CAP = MODEL.cooling_cap_c;
const ROOF_SURFACE_C = round((MODEL.roof.albedo_gain * MODEL.roof.sun_w_m2) / MODEL.roof.heat_transfer_w_m2k, 1);
const { co2_kg_yr: TREE_CO2, canopy_m2: CANOPY_M2 } = MODEL.tree;
const { nowak_gain: NOWAK_GAIN, nowak_canopy: NOWAK_CANOPY } = MODEL.air_quality;
const LANDMARK_R = MODEL.landmark_radius_cells;
const HOT_PCT = MODEL.hot_percentile;
const OUTDOOR_BELOW = MODEL.outdoor_building_frac_below;

function kernel(sigma) {
  const rad = Math.ceil(3 * sigma);
  const size = 2 * rad + 1;
  const k = new Float64Array(size * size);
  for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) k[(y + rad) * size + x + rad] = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
  return { rad, size, k };
}
const KERNELS = Object.fromEntries(Object.entries(TYPES).filter(([, t]) => t.sigma).map(([n, t]) => [n, kernel(t.sigma)]));

/** numpy.percentile (linear interpolation) on a plain array. */
function percentile(values, q) {
  const a = Float64Array.from(values).sort();
  const k = ((a.length - 1) * q) / 100;
  const lo = Math.floor(k), hi = Math.ceil(k);
  return a[lo] + (a[hi] - a[lo]) * (k - lo);
}

/** Add `weight × kernel` around every non-zero cell of `deposit` into `raw` (zero-padded edges, like scipy's mode="constant"). */
function spread(raw, deposit, rows, cols, { rad, size, k }, weight) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = deposit[r * cols + c];
      if (d === 0) continue;
      const w = weight * d;
      for (let dy = -rad; dy <= rad; dy++) {
        const rr = r + dy;
        if (rr < 0 || rr >= rows) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          const cc = c + dx;
          if (cc < 0 || cc >= cols) continue;
          raw[rr * cols + cc] += w * k[(dy + rad) * size + dx + rad];
        }
      }
    }
  }
}

/** Throws Error with a readable sentence if a placement breaks the rules. Placements are cell-form: {type,row,col,count}. */
export function validate(grid, placements) {
  const taken = new Set();
  placements.forEach((p, i) => {
    const where = `placement ${i} (${p.type} at ${p.row},${p.col})`;
    if (!TYPES[p.type]) throw new Error(`${where}: unknown type`);
    if (p.type === 'tree') {
      const max = RULES.tree.max_count_per_cell;
      if (!(p.count >= 1 && p.count <= max)) throw new Error(`${where}: count must be 1..${max}`);
    }
    const why = whyNot(grid, p.type, p.row, p.col, taken);
    if (why) throw new Error(`${where}: ${why}`);
    if (p.type !== 'tree') taken.add(`${p.type}:${p.row}:${p.col}`);
  });
}

/**
 * @param grid        from toGrid(block)
 * @param placements  cell-form [{type, row, col, count}]
 * @returns {metrics, cooling (Float32Array rows*cols, surface °C), breakdown, estimated}
 */
/** unitCost: the user's prices ({ tree, cool_roof, shade_stop } in ₹); anything missing uses the sourced default. */
export const prices = (unitCost) => Object.fromEntries(Object.entries(TYPES).map(([t, v]) => [t, Number(unitCost?.[t]) || v.cost]));

export function simulate(grid, placements, years = 10, unitCost = null) {
  const price = prices(unitCost);
  validate(grid, placements);
  const { rows, cols, lst, bf, roof, cellM } = grid;
  const n = rows * cols;
  const grown = maturity(years);

  const treeDep = new Float64Array(n), roofDep = new Float64Array(n), shaded = new Uint8Array(n);
  let trees = 0, roofM2 = 0, stops = 0;
  for (const p of placements) {
    const i = p.row * cols + p.col;
    if (p.type === 'tree') { const c = p.count ?? 1; trees += c; treeDep[i] += c * grown; }
    else if (p.type === 'cool_roof') { roofDep[i] += bf[i]; roofM2 += roof[i]; }
    else { shaded[i] = 1; stops += 1; }
  }
  const costParts = { tree: trees * price.tree, cool_roof: roofM2 * price.cool_roof, shade_stop: stops * price.shade_stop };
  const cost = costParts.tree + costParts.cool_roof + costParts.shade_stop;

  const blockM2 = n * cellM * cellM;
  const addedCanopy = (trees * grown * CANOPY_M2) / blockM2;
  const aqiGain = (NOWAK_GAIN * addedCanopy) / NOWAK_CANOPY;

  const raw = new Float64Array(n);
  spread(raw, treeDep, rows, cols, KERNELS.tree, TYPES.tree.cool_c);
  spread(raw, roofDep, rows, cols, KERNELS.cool_roof, TYPES.cool_roof.cool_c);

  const street = new Float64Array(n), surface = new Float64Array(n), cooling = new Float32Array(n);
  let surfaceSum = 0, surfaceMax = -Infinity;
  for (let i = 0; i < n; i++) {
    street[i] = CAP * (1 - Math.exp(-raw[i] / CAP));
    surface[i] = street[i] + ROOF_SURFACE_C * roofDep[i];
    cooling[i] = round(surface[i], 2);
    surfaceSum += surface[i];
    if (surface[i] > surfaceMax) surfaceMax = surface[i];
  }

  const outdoor = new Uint8Array(n);
  const outLst = [];
  for (let i = 0; i < n; i++) if (bf[i] < OUTDOOR_BELOW) { outdoor[i] = 1; outLst.push(lst[i]); }
  const hot = percentile(outLst, HOT_PCT);
  let exposedBefore = 0, exposedAfter = 0, streetSum = 0, streetMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!outdoor[i]) continue;
    if (lst[i] >= hot) exposedBefore++;
    if (lst[i] - street[i] >= hot && !shaded[i]) exposedAfter++;
    streetSum += street[i];
    if (street[i] > streetMax) streetMax = street[i];
  }
  const outCount = outLst.length;
  const tempDrop = streetSum / outCount;

  const near = (lm) => {
    let sum = 0, cnt = 0;
    for (let r = Math.max(lm.row - LANDMARK_R, 0); r < Math.min(lm.row + LANDMARK_R + 1, rows); r++)
      for (let c = Math.max(lm.col - LANDMARK_R, 0); c < Math.min(lm.col + LANDMARK_R + 1, cols); c++)
        if (outdoor[r * cols + c]) { sum += street[r * cols + c]; cnt++; }
    return cnt ? round(sum / cnt, 2) : 0;
  };
  const landmarkCooling = Object.fromEntries(grid.landmarks.map((lm) => [lm.name, near(lm)]));

  return {
    metrics: {
      temp_reduction_c: round(tempDrop, 3),
      peak_reduction_c: round(streetMax, 2),
      surface_reduction_c: round(surfaceSum / n, 3),
      roof_surface_reduction_c: roofM2 ? round(surfaceMax, 2) : 0,
      heat_exposure_pct: round((100 * exposedAfter) / outCount, 1),
      heat_exposure_reduction_pct: round((100 * (exposedBefore - exposedAfter)) / exposedBefore, 1),
      co2_captured_kg_per_year: round(trees * TREE_CO2 * grown),
      aqi_change: round(-aqiGain * grid.baselineAqi, 3),
      total_cost_inr: round(cost),
      cost_per_degree_inr: tempDrop > 1e-6 ? round(cost / tempDrop) : null,
      landmark_cooling_c: landmarkCooling,
    },
    cooling,
    breakdown: {
      trees, roof_m2: round(roofM2), stops, maturity: round(grown, 4),
      canopy_m2_per_tree: CANOPY_M2, added_canopy_pct: round(addedCanopy * 100, 2),
      aq_gain_pct: round(aqiGain * 100, 4), nowak_gain_pct: NOWAK_GAIN * 100, nowak_canopy_pct: NOWAK_CANOPY * 100,
      baseline_aqi: grid.baselineAqi, growth_tau: MODEL.tree.growth_tau_years,
      cells: n, cell_m: cellM, roof_surface_c: ROOF_SURFACE_C,
      tree_cool_c: TYPES.tree.cool_c, tree_reach_m: round(TYPES.tree.sigma * 3 * cellM),
      roof_cool_c: TYPES.cool_roof.cool_c, cap_c: CAP, tree_co2_kg: TREE_CO2,
      hot_threshold_c: round(hot, 1), hot_percentile: HOT_PCT,
      outdoor_cells: outCount, exposed_before: exposedBefore, exposed_after: exposedAfter,
      unit_cost: Object.fromEntries(Object.entries(price).map(([t, v]) => [t, round(v)])),
      cost_parts: Object.fromEntries(Object.entries(costParts).map(([t, v]) => [t, round(v)])),
    },
    estimated: true,
  };
}
