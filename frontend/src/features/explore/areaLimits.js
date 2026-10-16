// The MVP area limits, mirrored from backend/app/geodata/grid.py (both read shared/model.json), so the map can say
// "too large" while the user drags instead of failing after they press Build.
import { AREA } from '../../model/rules.js';

const M_PER_DEG_LAT = 111_320;
const slack = 1 + AREA.tolerance;   // a box drawn "at the limit" must not flicker over it from rounding

export function measure({ north, south, east, west }) {
  const lat = ((north + south) / 2) * (Math.PI / 180);
  const w = (east - west) * M_PER_DEG_LAT * Math.cos(lat), h = (north - south) * M_PER_DEG_LAT;
  return { w, h, km2: (w * h) / 1e6 };
}

/** { state: 'ok'|'small'|'large'|'invalid', km2, w, h, message } with the same rules the server enforces. */
export function check(bounds) {
  const { north, south, east, west } = bounds;
  if (!(south < north && west < east)) return { state: 'invalid', km2: 0, w: 0, h: 0, message: 'Draw a box on the map.' };
  const m = measure(bounds);
  const km2 = `${m.km2.toFixed(2)} km²`;
  if (Math.min(m.w, m.h) < AREA.min_side_m / slack) return { state: 'small', ...m, message: `${km2} · too small: each side needs at least ${AREA.min_side_m} m` };
  if (Math.max(m.w, m.h) > AREA.max_side_m * slack || m.km2 > AREA.max_km2 * slack) return { state: 'large', ...m, message: `${km2} · too large: max ${AREA.max_km2} km²` };
  return { state: 'ok', ...m, message: `${km2} · ${Math.round(m.w)} × ${Math.round(m.h)} m` };
}

/** Shrink around the centre until the box is inside the limits (the box "snaps back" when released). */
export function clampToMax(b) {
  const { w, h } = measure(b);
  let s = Math.min(1, AREA.max_side_m / Math.max(w, h), Math.sqrt((AREA.max_km2 * 1e6) / (w * h)));
  if (s >= 1) return b;   // already inside the limits: leave it exactly as drawn
  s *= 0.995;             // land just inside the limit, not on it
  const cLat = (b.north + b.south) / 2, cLng = (b.east + b.west) / 2;
  const dLat = ((b.north - b.south) / 2) * s, dLng = ((b.east - b.west) / 2) * s;
  return { north: cLat + dLat, south: cLat - dLat, east: cLng + dLng, west: cLng - dLng };
}

/** Grow around the centre until both sides reach the minimum. */
export function growToMin(b) {
  const { w, h } = measure(b);
  const need = AREA.min_side_m * 1.02;
  const sx = Math.max(1, need / w), sy = Math.max(1, need / h);
  if (sx === 1 && sy === 1) return b;
  const cLat = (b.north + b.south) / 2, cLng = (b.east + b.west) / 2;
  const dLat = ((b.north - b.south) / 2) * sy, dLng = ((b.east - b.west) / 2) * sx;
  return { north: cLat + dLat, south: cLat - dLat, east: cLng + dLng, west: cLng - dLng };
}

/** A sensible starting box around a point: 600 m square (inside the limits, about a neighbourhood). */
export function boxAround(lat, lng, metres = 600) {
  const dLat = metres / 2 / M_PER_DEG_LAT, dLng = metres / 2 / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return { north: lat + dLat, south: lat - dLat, east: lng + dLng, west: lng - dLng };
}
