import { describe, expect, it } from 'vitest';
import { buildIndex, buildingAt, buildingsOf, cellsForPolygon, clipToRect, groundHit, pickBuilding, pointInPolygon, polygonArea } from './geometry.js';

const grid = { rows: 10, cols: 10, cellM: 10, bf: new Float64Array(100) };
const square = (x, z, s) => [[x, z], [x + s, z], [x + s, z + s], [x, z + s]];

describe('diorama geometry', () => {
  it('point in polygon', () => {
    expect(pointInPolygon(5, 5, square(0, 0, 10))).toBe(true);
    expect(pointInPolygon(15, 5, square(0, 0, 10))).toBe(false);
  });

  it('clips footprints that straddle the area edge, and drops ones fully outside', () => {
    const half = clipToRect(square(-10, 20, 20), 100, 100);
    expect(polygonArea(half)).toBeCloseTo(200, 6);
    expect(Math.min(...half.map((p) => p[0]))).toBe(0);
    expect(clipToRect(square(-50, -50, 20), 100, 100)).toEqual([]);
    expect(polygonArea(clipToRect(square(90, 90, 20), 100, 100))).toBeCloseTo(100, 6);   // corner overlap
    const bf = new Float64Array(100).fill(1);
    const out = buildingsOf({ buildings: [{ id: 'x', height_m: 9, poly: square(-10, 20, 20) }, { id: 'y', height_m: 9, poly: square(200, 0, 10) }] }, { ...grid, bf });
    expect(out.map((b) => b.id)).toEqual(['x']);
    expect(out[0].poly.every(([x, z]) => x >= 0 && x <= 100 && z >= 0 && z <= 100)).toBe(true);
  });

  it('a footprint maps to the roofed cells it touches', () => {
    const bf = new Float64Array(100); bf[2 * 10 + 2] = 1; bf[2 * 10 + 3] = 0.5;
    expect(cellsForPolygon(square(22, 22, 12), { ...grid, bf })).toEqual([[2, 2], [2, 3]]);
  });

  it('derives deterministic boxes for a grid-only block (the demo)', () => {
    const bf = new Float64Array(100); bf[11] = 0.9; bf[12] = 0.05;
    const g = { ...grid, bf };
    const a = buildingsOf({}, g), b = buildingsOf({}, g);
    expect(a).toHaveLength(1);
    expect(a).toEqual(b);
    expect(a[0].cells).toEqual([[1, 1]]);
    expect(a[0].height).toBeGreaterThan(5);
  });

  it('picks a roof through the tilted view ray and the ground behind it', () => {
    const buildings = [{ id: 'a', height: 20, poly: square(40, 40, 10), cells: [[4, 4]] }];
    const index = buildIndex(buildings, grid);
    expect(buildingAt(index, buildings, 45, 45, 10)).toBe(0);
    expect(buildingAt(index, buildings, 45, 45, 25)).toBeNull();
    // camera looking down at 38° elevation from the south, aimed at the roof top (45, 20, 45)
    const el = (38 * Math.PI) / 180, dir = { x: 0, y: -Math.sin(el), z: -Math.cos(el) };
    const origin = { x: 45 - dir.x * 100, y: 20 - dir.y * 100, z: 45 - dir.z * 100 };
    expect(pickBuilding(index, buildings, origin, dir, 30)).toBe(0);
    expect(pickBuilding(index, buildings, { ...origin, x: 90 }, dir, 30)).toBeNull();
    expect(groundHit(origin, dir).z).toBeCloseTo(45 - 20 / Math.tan(el), 5);
    expect(groundHit({ x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
  });
});
