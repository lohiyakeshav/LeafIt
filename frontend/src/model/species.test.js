import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toGrid } from './grid.js';
import { capacityOf, crownRatio, freeM2, speciesMaturity, suits } from './rules.js';
import { fromCellPlacements, toCellPlacements, treeItem } from './placements.js';
import { AUTO, SPECIES_LIST, autoSpecies, speciesOptions } from './species.js';
import { ZONES, zoneBounds, zoneOf } from './zones.js';

const root = new URL('../../../', import.meta.url);
const raw = JSON.parse(readFileSync(new URL('backend/data/blocks/lajpat_nagar.json', root), 'utf8'));
const grid = toGrid(raw);

describe('zones (must equal the Python zones)', () => {
  it('splits the grid into thirds, row 0 north, and covers every cell exactly once', () => {
    const b = zoneBounds(60, 60);
    expect(b.NW).toEqual([0, 20, 0, 20]);
    expect(b.SE).toEqual([40, 60, 40, 60]);
    expect(b.C).toEqual([20, 40, 20, 40]);
    const seen = new Set();
    for (let r = 0; r < 60; r++) for (let c = 0; c < 60; c++) seen.add(zoneOf(r, c, 60, 60));
    expect(new Set(seen)).toEqual(new Set(ZONES));
  });

  it('rounds uneven sizes the same way numpy does (half to even)', () => {
    // numpy.linspace(0, 70, 4).round() -> [0, 23, 47, 70]; linspace(0, 100, 4).round() -> [0, 33, 67, 100]
    expect(zoneBounds(70, 100).NW).toEqual([0, 23, 0, 33]);
    expect(zoneBounds(70, 100).SE).toEqual([47, 70, 67, 100]);
    expect(zoneOf(69, 99, 70, 100)).toBe('SE');
  });
});

describe('species', () => {
  it('offers every catalogued species except the generic baseline, flagged by climate', () => {
    expect(SPECIES_LIST.find((s) => s.id === 'generic')).toBeUndefined();
    const humid = Object.fromEntries(speciesOptions('humid').map((s) => [s.id, s.suitable]));
    expect(humid.pongamia).toBe(true);
    expect(humid.amaltas).toBe(false);                                   // not tagged for humid climates
    expect(speciesOptions('hot_dry').find((s) => s.id === 'pongamia').suitable).toBe(false);
    expect(speciesOptions(null).every((s) => s.suitable)).toBe(true);    // unknown climate: nothing is ruled out
    expect(AUTO).toBe('auto');
  });

  // an open cell with room for a pit (most road cells in the real sample are carriageway, which takes no trees)
  const roadCell = () => { const i = grid.lc.findIndex((v, k) => grid.bf[k] === 0 && grid.carriageway[k] < 0.3 && grid.canopy[k] < 0.3 && freeM2(grid, k) >= 50); return [Math.floor(i / grid.cols), i % grid.cols]; };

  it('auto picks a species that suits the climate and fits the cell, and the generic tree when nothing fits', () => {
    const [r, c] = roadCell();
    const pick = autoSpecies(grid, 10, r, c);
    expect(SPECIES_LIST.map((s) => s.id)).toContain(pick);
    expect(SPECIES_LIST.find((s) => s.id === pick).climates).toContain('hot_dry');   // Lajpat Nagar is hot-dry
    const packed = { ...grid, bf: Float64Array.from(grid.bf, () => 1) };            // every cell fully built: no ground for a pit
    expect(autoSpecies(packed, 10, r, c)).toBe('generic');
  });

  it('auto maximises what a fully planted cell shades at the chosen horizon', () => {
    const [r, c] = roadCell();
    const free = freeM2(grid, r * grid.cols + c);
    for (const years of [1, 5, 10, 20, 30]) {
      const score = (s) => capacityOf(s, free, grid.cellM) * crownRatio(s) * speciesMaturity(s, years);
      const eligible = SPECIES_LIST.filter((s) => suits(s, grid.climate) && capacityOf(s, free, grid.cellM) >= 1);
      const best = Math.max(...eligible.map(score));
      expect(score(SPECIES_LIST.find((s) => s.id === autoSpecies(grid, years, r, c)))).toBeCloseTo(best, 9);
    }
  });
});

describe('species in placements', () => {
  it('keeps species per tree, groups by species in one cell, and round-trips through cell form', () => {
    const items = [treeItem(15, 15, 10, 'neem'), treeItem(16, 16, 10, 'neem'), treeItem(17, 17, 10, 'peepal'), treeItem(18, 18, 10)];
    const cells = toCellPlacements(items);
    expect(cells).toEqual([
      { type: 'tree', row: 1, col: 1, count: 2, species: 'neem' },
      { type: 'tree', row: 1, col: 1, count: 1, species: 'peepal' },
      { type: 'tree', row: 1, col: 1, count: 1 },                        // the generic tree carries no species field
    ]);
    const back = fromCellPlacements(cells, 10).filter((i) => i.type === 'tree');
    expect(back.map((i) => i.species)).toEqual(['neem', 'neem', 'peepal', undefined]);
    expect(treeItem(1, 1, 10, 'generic').species).toBeUndefined();
  });
});

describe('humid rule near one new tree', () => {
  it('gives the same answer as checking the whole plan', async () => {
    const { humidViolation, humidViolationAt, crownM2, speciesOf } = await import('./rules.js');
    const { plannedCrownM2 } = await import('./placements.js');
    const g = { ...grid, humid: true };
    const items = [];
    let agree = 0;
    for (let k = 0; k < 400; k++) {                          // grow a dense plan cell by cell, comparing both checks each time
      const row = 10 + (k % 12), col = 10 + Math.floor(k / 12) % 12;
      const fast = humidViolationAt(g, plannedCrownM2(g, items), row, col, crownM2(speciesOf(null)));
      const full = humidViolation(g, plannedCrownM2(g, items, [{ type: 'tree', row, col }]));
      expect(fast).toBe(full);
      if (!full) items.push({ type: 'tree', row, col });
      agree++;
    }
    expect(agree).toBe(400);
  });
});
