import { describe, expect, it } from 'vitest';
import { pickZoom, tilePlan } from './satelliteTexture.js';

const box = (lat, lng, mW, mH) => {
  const dlat = mH / 111320 / 2, dlng = mW / (111320 * Math.cos((lat * Math.PI) / 180)) / 2;
  return { north: lat + dlat, south: lat - dlat, east: lng + dlng, west: lng - dlng };
};

describe('satellite tiles', () => {
  it('uses the sharpest zoom that fits a 1536 px texture', () => {
    expect(pickZoom(box(28.57, 77.24, 200, 200))).toBe(19);   // a small area gets the sharpest tiles
    expect(pickZoom(box(28.57, 77.24, 700, 500))).toBe(18);
    expect(pickZoom(box(28.57, 77.24, 1000, 1000))).toBe(17); // 1 km at 1.05 m/px is ~950 px (z18 would be 1900)
    expect(pickZoom(box(28.57, 77.24, 1500, 600))).toBe(17);
  });

  it('plans a tile block that fully covers the area, with the crop inside it', () => {
    const b = box(28.57, 77.24, 700, 500);
    const p = tilePlan(b, 18);
    const w = (p.x1 - p.x0 + 1) * 256, h = (p.y1 - p.y0 + 1) * 256;
    expect(p.cropX).toBeGreaterThanOrEqual(0);
    expect(p.cropX + p.cropW).toBeLessThanOrEqual(w + 1e-6);
    expect(p.cropY + p.cropH).toBeLessThanOrEqual(h + 1e-6);
    expect(p.cropW / p.cropH).toBeCloseTo(700 / 500, 1);       // ground aspect is preserved
    expect((p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1)).toBeLessThanOrEqual(36);
  });

  it('keeps the largest allowed area (1 km²) to a small number of billable tile requests', () => {
    const b = box(28.57, 77.24, 1000, 1000);
    const p = tilePlan(b, pickZoom(b));
    expect((p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1)).toBeLessThanOrEqual(25);
  });
});
