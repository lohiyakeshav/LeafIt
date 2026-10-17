import { describe, expect, it } from 'vitest';
import { decodePlan, encodePlan } from './share.js';

describe('share links', () => {
  it('round-trips trees, stops and roofs', async () => {
    const items = [
      { id: 'a', type: 'tree', x: 12.34, z: 56.78, row: 5, col: 1 },
      { id: 'b', type: 'shade_stop', x: 40, z: 9.95, row: 0, col: 4 },
      { id: 'c', type: 'cool_roof', buildingId: 'bld7', cells: [[3, 4], [3, 5]], row: 3, col: 4 },
    ];
    const s = await encodePlan(items, 10);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);   // URL-safe
    const d = await decodePlan(s);
    expect(d.years).toBe(10);
    expect(d.packed).toEqual([['t', 12.3, 56.8], ['s', 40, 10], ['r', 'bld7', [[3, 4], [3, 5]]]]);
  });
  it('rejects garbage', async () => {
    expect(await decodePlan('not-a-plan')).toBeNull();
  });
});
