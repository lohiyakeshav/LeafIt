// Parity: the browser simulator must reproduce the Python one on the golden cases (shared/fixtures/golden.json).
// Regenerate fixtures only when the model changes ON PURPOSE:  cd backend && conda run -n leafit python scripts/make_golden.py
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toGrid } from './grid.js';
import { simulate, validate } from './sim.js';

const root = new URL('../../../', import.meta.url);
const golden = JSON.parse(readFileSync(new URL('shared/fixtures/golden.json', root), 'utf8'));
const raw = JSON.parse(readFileSync(new URL(golden.block, root), 'utf8'));
const grid = toGrid(raw);
// a case may override parts of the sample block (the fixture lists which): the rules the block alone can't exercise
const gridFor = (c) => toGrid({ ...raw, ...Object.fromEntries(golden.overridable.filter((k) => k in c).map((k) => [k, c[k]])) });

// rounded outputs may differ by one unit in the last place on exact ties; anything beyond that is a real drift
const close = (a, b, digits) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1.01 * 10 ** -digits);
const DIGITS = { temp_reduction_c: 3, air_reduction_c: 3, peak_reduction_c: 2, surface_reduction_c: 3, roof_surface_reduction_c: 2,
  heat_exposure_pct: 1, heat_exposure_reduction_pct: 1, co2_captured_kg_per_year: 0, aqi_change: 3, total_cost_inr: 0 };

describe('browser simulator matches the Python one', () => {
  for (const c of golden.cases) {
    it(c.name, () => {
      const g = gridFor(c);
      const out = simulate(g, c.placements, c.years);
      for (const [k, d] of Object.entries(DIGITS)) close(out.metrics[k], c.expected.metrics[k], d);
      if (c.expected.metrics.equity_cooling_c === null) expect(out.metrics.equity_cooling_c).toBeNull();
      else close(out.metrics.equity_cooling_c, c.expected.metrics.equity_cooling_c, 3);
      if (c.expected.metrics.cost_per_degree_inr === null) expect(out.metrics.cost_per_degree_inr).toBeNull();
      else expect(Math.abs(out.metrics.cost_per_degree_inr / c.expected.metrics.cost_per_degree_inr - 1)).toBeLessThan(0.01);
      for (const [name, v] of Object.entries(c.expected.metrics.landmark_cooling_c)) close(out.metrics.landmark_cooling_c[name], v, 2);
      for (const [k, d] of [['temp_reduction_c', 3], ['peak_reduction_c', 2], ['heat_exposure_pct', 1]]) close(out.metrics.low_estimate[k], c.expected.metrics.low_estimate[k], d);
      // ground temperature before → after: the whole area, the hottest tenth, and each landmark
      const want = c.expected.metrics.temps, got = out.metrics.temps;
      for (const k of ['before', 'after', 'after_low']) { close(got.area[k], want.area[k], 2); close(got.hottest[k], want.hottest[k], 2); }
      expect(Object.keys(got.landmarks).sort()).toEqual(Object.keys(want.landmarks).sort());
      for (const [name, t] of Object.entries(want.landmarks)) for (const k of ['before', 'after', 'after_low']) close(got.landmarks[name][k], t[k], 2);
      expect(Math.abs(out.cooling.reduce((a, b) => a + b, 0) - c.expected.cooling_sum)).toBeLessThan(0.5);
      expect(Math.abs(Math.max(...out.cooling) - c.expected.cooling_max)).toBeLessThan(0.011);
      for (const [rc, v] of Object.entries(c.expected.cooling_samples)) {
        const [r, col] = rc.split(',').map(Number);
        expect(Math.abs(out.cooling[r * g.cols + col] - v)).toBeLessThan(0.011);
      }
    });
  }

  it('is fast enough to run on every pointer move (hundreds of trees)', () => {
    const big = golden.cases.find((c) => c.name === 'many_trees');
    simulate(grid, big.placements, big.years); // warm up the JIT
    const t = performance.now();
    simulate(grid, big.placements, big.years);
    expect(performance.now() - t).toBeLessThan(50);
  });

  it('refuses placements the rules forbid, like the server does', () => {
    const roofCell = grid.roof.findIndex((v) => v > 0);
    const [r, c] = [Math.floor(roofCell / grid.cols), roofCell % grid.cols];
    expect(() => validate(grid, [{ type: 'tree', row: r, col: c, count: 1 }])).toThrow(/no room/i);
    expect(() => validate(grid, [{ type: 'tree', row: -1, col: 0, count: 1 }])).toThrow();
    expect(() => validate(grid, [{ type: 'tree', row: 0, col: 0, count: 11 }])).toThrow(/count must be/);
    expect(() => validate(grid, [{ type: 'cool_roof', row: r, col: c }, { type: 'cool_roof', row: r, col: c }])).toThrow(/already/);
  });
});

describe('user-edited prices', () => {
  const open = golden.cases.find((c) => c.name === 'fifty_trees').placements[0];   // a cell the rules accept in the real sample
  const pl = [{ type: 'tree', row: open.row, col: open.col, count: 2 }];
  it('change every cost figure, and only those', () => {
    const base = simulate(grid, pl, 10), cheap = simulate(grid, pl, 10, { tree: 1500 });
    expect(base.metrics.total_cost_inr).toBe(6000);
    expect(cheap.metrics.total_cost_inr).toBe(3000);
    expect(cheap.breakdown.unit_cost.tree).toBe(1500);
    expect(cheap.metrics.cost_per_degree_inr).toBeCloseTo(base.metrics.cost_per_degree_inr / 2, -1);
    expect(cheap.metrics.temp_reduction_c).toBe(base.metrics.temp_reduction_c);   // prices don't change physics
  });
  it('fall back to defaults when missing or invalid', () => {
    expect(simulate(grid, pl, 10, { tree: 0 }).metrics.total_cost_inr).toBe(6000);
    expect(simulate(grid, pl, 10, {}).metrics.total_cost_inr).toBe(6000);
  });
});
