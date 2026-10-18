// Browser port of backend/app/domain/sim.py (+ canopy.py, plantable.py): same formulas, same numbers (shared/model.json,
// shared/species.json), no network. It gives instant feedback while the user paints trees; the server's /simulate stays
// the canonical result (Review, saved plans, agent). sim.test.js replays shared/fixtures/golden.json so the two cannot drift.
import {
  AIR, CANOPY, MODEL, RULES, SPECIES_BY_ID, TYPES, crownM2, crownRatio, humidViolation, round, speciesMaturity, speciesOf, spacingM,
  maturity, whyNot,
} from './rules.js';

const CAP = MODEL.cooling_cap_c;
const LOW_SHARE = TYPES.tree.cool_c_low / TYPES.tree.cool_c;   // low end of the published range (see sim.py TREE_LOW_SHARE)
const ROOF_SURFACE_C = round((MODEL.roof.albedo_gain * MODEL.roof.sun_w_m2) / MODEL.roof.heat_transfer_w_m2k, 1);
const { co2_kg_yr: TREE_CO2, canopy_m2: CANOPY_M2 } = MODEL.tree;
const { nowak_gain: NOWAK_GAIN, nowak_canopy: NOWAK_CANOPY } = MODEL.air_quality;
const LANDMARK_R = MODEL.landmark_radius_cells;
const HOT_PCT = MODEL.hot_percentile;
const HOTTEST_PCT = MODEL.hottest_percentile;   // "the hottest tenth of the ground" in the before → after table
const OUTDOOR_BELOW = MODEL.outdoor_building_frac_below;

function kernel(sigma) {
  const rad = Math.ceil(3 * sigma);
  const size = 2 * rad + 1;
  const k = new Float64Array(size * size);
  for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) k[(y + rad) * size + x + rad] = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
  const sum = k.reduce((a, v) => a + v, 0);
  for (let i = 0; i < k.length; i++) k[i] /= sum;   // sums to 1, as in the backend: cooling is spread, not multiplied
  return { rad, size, k };
}
const KERNELS = Object.fromEntries(Object.entries(TYPES).filter(([, t]) => t.sigma).map(([n, t]) => [n, kernel(t.sigma)]));
const AIR_KERNEL = kernel(AIR.sigma);

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

const shadeWeight = (h) => Math.min(1, Math.max(0, (h - CANOPY.min_height_m) / (CANOPY.full_height_m - CANOPY.min_height_m)));
const equivalents = (frac, h, cellM) => Float64Array.from(frac, (f, i) => (f * cellM * cellM / CANOPY.crown_ref_m2) * shadeWeight(h[i]));

const existingCache = new WeakMap();
/** Shade that is already there, inside the box and in the ring around it: { equiv, surface, air } per cell (canopy.py). */
export function existing(grid) {
  if (existingCache.has(grid)) return existingCache.get(grid);
  const { rows, cols, cellM, ring } = grid;
  const equiv = equivalents(grid.canopy, grid.canopyH, cellM);
  const surface = new Float64Array(rows * cols), air = new Float64Array(rows * cols);
  if (ring) {
    const { pad, rows: R, cols: C } = ring;
    const big = equivalents(ring.canopy, ring.canopyH, cellM);
    const rs = new Float64Array(R * C), ra = new Float64Array(R * C);
    spread(rs, big, R, C, KERNELS.tree, TYPES.tree.cool_c);
    spread(ra, big, R, C, AIR_KERNEL, AIR.per_tree_c);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { surface[r * cols + c] = rs[(r + pad) * C + c + pad]; air[r * cols + c] = ra[(r + pad) * C + c + pad]; }
  } else {
    spread(surface, equiv, rows, cols, KERNELS.tree, TYPES.tree.cool_c);
    spread(air, equiv, rows, cols, AIR_KERNEL, AIR.per_tree_c);
  }
  const out = { equiv, surface, air };
  existingCache.set(grid, out);
  return out;
}

/** Extra cooling from `nw` on top of `ex`, both raw exposure: saturating, so shade beside shade adds little. */
const marginal = (ex, nw, cap) => cap * Math.exp(-ex / cap) * (1 - Math.exp(-nw / cap));

/** Throws Error with a readable sentence if a placement breaks the rules. Placements are cell-form: {type,row,col,count,species?}. */
export function validate(grid, placements) {
  const taken = new Set();
  const cellTrees = new Map(), cellSpecies = new Map();   // trees per cell, and the most space-hungry species there
  const planned = grid.humid ? new Float64Array(grid.rows * grid.cols) : null;
  placements.forEach((p, i) => {
    const where = `placement ${i} (${p.type} at ${p.row},${p.col})`;
    if (!TYPES[p.type]) throw new Error(`${where}: unknown type`);
    if (p.type === 'tree') {
      const max = RULES.tree.max_count_per_cell;
      const n = p.count ?? 1;
      if (!(n >= 1 && n <= max)) throw new Error(`${where}: count must be 1..${max}`);
      if (p.species && !SPECIES_BY_ID[p.species]) throw new Error(`${where}: unknown species`);
      const sp = speciesOf(p.species), key = `${p.row}:${p.col}`;
      const prev = cellSpecies.get(key);
      const worst = !prev || spacingM(sp) >= spacingM(prev) ? sp : prev;
      cellSpecies.set(key, worst);
      cellTrees.set(key, (cellTrees.get(key) ?? 0) + n);
      const why = whyNot(grid, 'tree', p.row, p.col, taken, { total: cellTrees.get(key), species: worst.id });
      if (why) throw new Error(`${where}: ${why}`);
      if (planned) planned[p.row * grid.cols + p.col] += n * crownM2(sp);
      return;
    }
    const why = whyNot(grid, p.type, p.row, p.col, taken);
    if (why) throw new Error(`${where}: ${why}`);
    taken.add(`${p.type}:${p.row}:${p.col}`);
  });
  if (planned && humidViolation(grid, planned)) throw new Error('Too many trees close together for a humid climate: leave room for air to move');
}

/** unitCost: the user's prices ({ tree, cool_roof, shade_stop } in ₹); anything missing uses the sourced default. */
export const prices = (unitCost) => Object.fromEntries(Object.entries(TYPES).map(([t, v]) => [t, Number(unitCost?.[t]) || v.cost]));

/** What cell-form `placements` cost in ₹, priced exactly as simulate() does; cheap enough to run before every placement. */
export function planCost(grid, placements, unitCost = null) {
  const price = prices(unitCost);
  let cost = 0;
  for (const p of placements) {
    cost += p.type === 'tree' ? (p.count ?? 1) * price.tree : p.type === 'cool_roof' ? grid.roof[p.row * grid.cols + p.col] * price.cool_roof : price.shade_stop;
  }
  return cost;
}

/** Mean cooling where exposure is highest (top quartile of outdoor cells), or null without population data. */
function equity(grid, street, outdoor) {
  const { exposure } = grid;
  if (!exposure) return null;
  const vals = [];
  for (let i = 0; i < exposure.length; i++) if (outdoor[i]) vals.push(exposure[i]);
  if (!vals.some((v) => v > 0)) return null;
  const thr = percentile(vals, 75);
  let sum = 0, n = 0;
  for (let i = 0; i < exposure.length; i++) if (outdoor[i] && exposure[i] >= thr) { sum += street[i]; n++; }
  return n ? round(sum / n, 3) : null;
}

/**
 * @param grid        from toGrid(block)
 * @param placements  cell-form [{type, row, col, count, species?}]
 * @returns {metrics, cooling (Float32Array rows*cols, surface °C), breakdown, estimated}
 */
export function simulate(grid, placements, years = 10, unitCost = null) {
  const price = prices(unitCost);
  validate(grid, placements);
  const { rows, cols, lst, bf, roof, cellM } = grid;
  const n = rows * cols;
  const grown = maturity(years);

  const treeUnits = new Float64Array(n), roofDep = new Float64Array(n), shaded = new Uint8Array(n);
  let trees = 0, roofM2 = 0, stops = 0, crownGrown = 0, co2Kg = 0;
  const bySpecies = {};
  for (const p of placements) {
    const i = p.row * cols + p.col;
    if (p.type === 'tree') {
      const c = p.count ?? 1, sp = speciesOf(p.species);
      const mat = speciesMaturity(sp, years), ratio = crownRatio(sp);
      trees += c; treeUnits[i] += c * mat * ratio; crownGrown += c * mat * crownM2(sp); co2Kg += c * TREE_CO2 * mat * ratio;
      bySpecies[sp.id] = (bySpecies[sp.id] ?? 0) + c;
    } else if (p.type === 'cool_roof') { roofDep[i] += bf[i]; roofM2 += roof[i]; }
    else { shaded[i] = 1; stops += 1; }
  }
  const costParts = { tree: trees * price.tree, cool_roof: roofM2 * price.cool_roof, shade_stop: stops * price.shade_stop };
  const cost = costParts.tree + costParts.cool_roof + costParts.shade_stop;

  const blockM2 = n * cellM * cellM;
  const addedCanopy = crownGrown / blockM2;
  const aqiGain = (NOWAK_GAIN * addedCanopy) / NOWAK_CANOPY;

  const ex = existing(grid);
  const treeSurface = new Float64Array(n), roofSpill = new Float64Array(n), newAir = new Float64Array(n);
  spread(treeSurface, treeUnits, rows, cols, KERNELS.tree, TYPES.tree.cool_c);
  spread(roofSpill, roofDep, rows, cols, KERNELS.cool_roof, TYPES.cool_roof.cool_c);
  spread(newAir, treeUnits, rows, cols, AIR_KERNEL, AIR.per_tree_c);

  const street = new Float64Array(n), low = new Float64Array(n), air = new Float64Array(n), cooling = new Float32Array(n);
  let surfaceSum = 0, surfaceMax = -Infinity;
  for (let i = 0; i < n; i++) {
    street[i] = marginal(ex.surface[i], treeSurface[i] + roofSpill[i], CAP);
    low[i] = marginal(ex.surface[i] * LOW_SHARE, treeSurface[i] * LOW_SHARE + roofSpill[i], CAP);
    air[i] = marginal(ex.air[i], newAir[i], AIR.cap_c);
    const surface = street[i] + ROOF_SURFACE_C * roofDep[i];
    cooling[i] = round(surface, 2);
    surfaceSum += surface;
    if (surface > surfaceMax) surfaceMax = surface;
  }

  const outdoor = new Uint8Array(n);
  const outLst = [];
  for (let i = 0; i < n; i++) if (bf[i] < OUTDOOR_BELOW) { outdoor[i] = 1; outLst.push(lst[i]); }
  const hot = percentile(outLst, HOT_PCT);
  let exposedBefore = 0, exposedAfter = 0, exposedAfterLow = 0, streetSum = 0, streetMax = -Infinity, lowSum = 0, lowMax = -Infinity, airSum = 0;
  for (let i = 0; i < n; i++) {
    if (!outdoor[i]) continue;
    if (lst[i] >= hot) exposedBefore++;
    if (lst[i] - street[i] >= hot && !shaded[i]) exposedAfter++;
    if (lst[i] - low[i] >= hot && !shaded[i]) exposedAfterLow++;
    streetSum += street[i]; lowSum += low[i]; airSum += air[i];
    if (street[i] > streetMax) streetMax = street[i];
    if (low[i] > lowMax) lowMax = low[i];
  }
  const outCount = outLst.length;
  const tempDrop = streetSum / outCount, lowDrop = lowSum / outCount;

  const near = (lm) => {
    let sum = 0, cnt = 0;
    for (let r = Math.max(lm.row - LANDMARK_R, 0); r < Math.min(lm.row + LANDMARK_R + 1, rows); r++)
      for (let c = Math.max(lm.col - LANDMARK_R, 0); c < Math.min(lm.col + LANDMARK_R + 1, cols); c++)
        if (outdoor[r * cols + c]) { sum += street[r * cols + c]; cnt++; }
    return cnt ? round(sum / cnt, 2) : 0;
  };
  const landmarkCooling = Object.fromEntries(grid.landmarks.map((lm) => [lm.name, near(lm)]));

  // ground temperature before → after (mean over `pick`ed outdoor cells): today, and with the plan at the high and low end of the range
  const temps = (pick) => {
    let b = 0, a = 0, l = 0, cnt = 0;
    for (let i = 0; i < n; i++) if (outdoor[i] && pick(i)) { b += lst[i]; a += lst[i] - street[i]; l += lst[i] - low[i]; cnt++; }
    return cnt ? { before: round(b / cnt, 2), after: round(a / cnt, 2), after_low: round(l / cnt, 2) } : null;
  };
  const hottestFrom = percentile(outLst, HOTTEST_PCT);
  const tempsNear = (lm) => {
    const r0 = Math.max(lm.row - LANDMARK_R, 0), r1 = Math.min(lm.row + LANDMARK_R, rows - 1), c0 = Math.max(lm.col - LANDMARK_R, 0), c1 = Math.min(lm.col + LANDMARK_R, cols - 1);
    return temps((i) => { const r = Math.floor(i / cols), c = i % cols; return r >= r0 && r <= r1 && c >= c0 && c <= c1; });
  };
  let equiv = 0;
  for (let i = 0; i < n; i++) equiv += ex.equiv[i];

  return {
    metrics: {
      temp_reduction_c: round(tempDrop, 3),
      air_reduction_c: round(airSum / outCount, 3),
      equity_cooling_c: equity(grid, street, outdoor),
      peak_reduction_c: round(streetMax, 2),
      surface_reduction_c: round(surfaceSum / n, 3),
      roof_surface_reduction_c: roofM2 ? round(surfaceMax, 2) : 0,
      heat_exposure_pct: round((100 * exposedAfter) / outCount, 1),
      heat_exposure_reduction_pct: round((100 * (exposedBefore - exposedAfter)) / exposedBefore, 1),
      co2_captured_kg_per_year: round(co2Kg),
      aqi_change: round(-aqiGain * (grid.baselineAqi ?? 0), 3),
      total_cost_inr: round(cost),
      cost_per_degree_inr: tempDrop > 1e-6 ? round(cost / tempDrop) : null,
      landmark_cooling_c: landmarkCooling,
      temps: {
        area: temps(() => true), hottest: temps((i) => lst[i] >= hottestFrom),
        landmarks: Object.fromEntries(grid.landmarks.map((lm) => [lm.name, tempsNear(lm)]).filter(([, t]) => t)),
      },
      low_estimate: {
        temp_reduction_c: round(lowDrop, 3),
        peak_reduction_c: round(lowMax, 2),
        heat_exposure_pct: round((100 * exposedAfterLow) / outCount, 1),
        heat_exposure_reduction_pct: round((100 * (exposedBefore - exposedAfterLow)) / exposedBefore, 1),
        cost_per_degree_inr: lowDrop > 1e-6 ? round(cost / lowDrop) : null,
      },
    },
    cooling,
    breakdown: {
      trees, roof_m2: round(roofM2), stops, maturity: round(grown, 4), trees_by_species: bySpecies,
      canopy_m2_per_tree: CANOPY_M2, added_canopy_pct: round(addedCanopy * 100, 2),
      aq_gain_pct: round(aqiGain * 100, 4), nowak_gain_pct: NOWAK_GAIN * 100, nowak_canopy_pct: NOWAK_CANOPY * 100,
      baseline_aqi: grid.baselineAqi, growth_tau: MODEL.tree.growth_tau_years,
      cells: n, cell_m: cellM, roof_surface_c: ROOF_SURFACE_C,
      tree_cool_c: TYPES.tree.cool_c, tree_cool_c_low: TYPES.tree.cool_c_low, tree_reach_m: round(TYPES.tree.sigma * 3 * cellM),
      roof_cool_c: TYPES.cool_roof.cool_c, cap_c: CAP, air_cap_c: AIR.cap_c, tree_co2_kg: TREE_CO2,
      existing_tree_equivalents: round(equiv), climate_class: grid.climate,
      hot_threshold_c: round(hot, 1), hot_percentile: HOT_PCT,
      outdoor_cells: outCount, exposed_before: exposedBefore, exposed_after: exposedAfter,
      unit_cost: Object.fromEntries(Object.entries(price).map(([t, v]) => [t, round(v)])),
      cost_parts: Object.fromEntries(Object.entries(costParts).map(([t, v]) => [t, round(v)])),
    },
    estimated: true,
  };
}
