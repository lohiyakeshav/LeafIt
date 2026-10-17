// Parity: the browser simulator must reproduce the Python one on the golden cases (shared/fixtures/golden.json).
// Regenerate fixtures only when the model changes ON PURPOSE:  cd backend && conda run -n leafit python scripts/make_golden.py
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toGrid } from './grid.js';
import { simulate, validate } from './sim.js';

const root = new URL('../../../', import.meta.url);
const golden = JSON.parse(readFileSync(new URL('shared/fixtures/golden.json', root), 'utf8'));
const grid = toGrid(JSON.parse(readFileSync(new URL(golden.block, root), 'utf8')));

// rounded outputs may differ by one unit in the last place on exact ties; anything beyond that is a real drift
const close = (a, b, digits) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1.01 * 10 ** -digits);
const DIGITS = { temp_reduction_c: 3, peak_reduction_c: 2, surface_reduction_c: 3, roof_surface_reduction_c: 2,
  heat_exposure_pct: 1, heat_exposure_reduction_pct: 1, co2_captured_kg_per_year: 0, aqi_change: 3, total_cost_inr: 0 };

describe('browser simulator matches the Python one', () => {
  for (const c of golden.cases) {
    it(c.name, () => {
      const out = simulate(grid, c.placements, c.years);
      for (const [k, d] of Object.entries(DIGITS)) close(out.metrics[k], c.expected.metrics[k], d);
      if (c.expected.metrics.cost_per_degree_inr === null) expect(out.metrics.cost_per_degree_inr).toBeNull();
      else expect(Math.abs(out.metrics.cost_per_degree_inr / c.expected.metrics.cost_per_degree_inr - 1)).toBeLessThan(0.01);
      for (const [name, v] of Object.entries(c.expected.metrics.landmark_cooling_c)) close(out.metrics.landmark_cooling_c[name], v, 2);
      expect(Math.abs(out.cooling.reduce((a, b) => a + b, 0) - c.expected.cooling_sum)).toBeLessThan(0.5);
      expect(Math.abs(Math.max(...out.cooling) - c.expected.cooling_max)).toBeLessThan(0.011);
      for (const [rc, v] of Object.entries(c.expected.cooling_samples)) {
        const [r, col] = rc.split(',').map(Number);
        expect(Math.abs(out.cooling[r * grid.cols + col] - v)).toBeLessThan(0.011);
      }
    });
  }

  it('is fast enough to run on every pointer move (1000 trees)', () => {
    const big = golden.cases.find((c) => c.name === 'thousand_trees');
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
  const pl = [{ type: 'tree', row: 5, col: 5, count: 2 }];
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
