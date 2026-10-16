import { describe, expect, it } from 'vitest';
import { coatedCells, fromCellPlacements, roofItem, toCellPlacements, treeItem, treesInCell, withoutCell, withoutNearest } from './placements.js';

describe('placements', () => {
  it('sums trees per cell, caps at 10, and counts a roof or stop once per cell', () => {
    const items = [...Array(12)].map((_, i) => treeItem(15 + i * 0.1, 15, 10));
    const cells = toCellPlacements([...items, roofItem([[3, 3], [3, 4]]), roofItem([[3, 4], [4, 4]])]);
    expect(cells.find((p) => p.type === 'tree')).toMatchObject({ row: 1, col: 1, count: 10 });
    expect(cells.filter((p) => p.type === 'cool_roof').map((p) => `${p.row},${p.col}`)).toEqual(['3,3', '3,4', '4,4']);
  });

  it('round-trips agent plans into positioned items inside the right cell, deterministically', () => {
    const plan = [{ type: 'tree', row: 5, col: 7, count: 4 }, { type: 'cool_roof', row: 2, col: 2, count: 1 }, { type: 'shade_stop', row: 9, col: 9, count: 1 }];
    const a = fromCellPlacements(plan, 10), b = fromCellPlacements(plan, 10);
    expect(a.map((i) => [i.x, i.z])).toEqual(b.map((i) => [i.x, i.z]));
    expect(a.filter((i) => i.type === 'tree').every((i) => i.row === 5 && i.col === 7 && i.x >= 70 && i.x < 80)).toBe(true);
    expect(toCellPlacements(a)).toEqual(plan);
    expect(treesInCell(a, 5, 7)).toBe(4);
    expect(coatedCells(a).has('2:2')).toBe(true);
  });

  it('removes by cell and by nearest item', () => {
    const items = fromCellPlacements([{ type: 'tree', row: 1, col: 1, count: 3 }, { type: 'cool_roof', row: 1, col: 1, count: 1 }], 10);
    expect(withoutCell(items, 1, 1)).toEqual([]);
    const t = items.find((i) => i.type === 'tree');
    expect(withoutNearest(items, t.x, t.z, 2, 10)).toHaveLength(3);
    expect(withoutNearest(items, 500, 500, 2, 10)).toHaveLength(4);
  });
});
