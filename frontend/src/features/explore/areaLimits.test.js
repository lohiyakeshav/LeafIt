import { describe, expect, it } from 'vitest';
import { boxAround, check, clampToMax, growToMin, measure } from './areaLimits.js';

const box = (mW, mH, lat = 28.57, lng = 77.24) => {
  const dLat = mH / 2 / 111320, dLng = mW / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  return { north: lat + dLat, south: lat - dLat, east: lng + dLng, west: lng - dLng };
};

describe('area limits', () => {
  it('classifies boxes like the server does', () => {
    expect(check(box(700, 700)).state).toBe('ok');
    expect(check(box(1000, 1000)).state).toBe('ok');                 // right at the 1 km² cap: must not flicker
    expect(check(box(150, 700)).state).toBe('small');
    expect(check(box(1200, 1200)).state).toBe('large');
    expect(check(box(1600, 200)).state).toBe('large');               // a side over 1.5 km
    expect(check({ north: 1, south: 2, east: 3, west: 4 }).state).toBe('invalid');
    expect(check(box(700, 700)).message).toMatch(/0\.49 km²/);
  });

  it('snaps an oversized box back inside the limits, around the same centre', () => {
    const big = box(3000, 2000);
    const fixed = clampToMax(big);
    expect(check(fixed).state).toBe('ok');
    expect((fixed.north + fixed.south) / 2).toBeCloseTo((big.north + big.south) / 2, 9);
    expect(clampToMax(box(500, 500))).toEqual(box(500, 500));         // already fine: untouched
  });

  it('grows a tiny box to the minimum', () => {
    expect(check(growToMin(box(50, 80))).state).toBe('ok');
    expect(measure(growToMin(box(50, 800))).w).toBeGreaterThanOrEqual(200);
  });

  it('starts from a valid box', () => {
    expect(check(boxAround(28.57, 77.24)).state).toBe('ok');
  });
});
