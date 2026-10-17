// The nine named zones (NW … SE) an area is split into, so plans can be talked about and steered by place.
// Mirrors backend/app/domain/zones.py exactly (thirds of the grid, row 0 = north, col 0 = west).
export const ZONES = ['NW', 'N', 'NE', 'W', 'C', 'E', 'SW', 'S', 'SE'];
export const ZONE_LABELS = { NW: 'north-west', N: 'north', NE: 'north-east', W: 'west', C: 'centre', E: 'east', SW: 'south-west', S: 'south', SE: 'south-east' };

// numpy.linspace(0, n, 4).round(): round-half-to-even on x.5, which JS Math.round is not
const cut = (n, i) => { const x = (n * i) / 3, f = Math.floor(x), d = x - f; return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1; };

/** zone -> [row0, row1, col0, col1] (end-exclusive). */
export function zoneBounds(rows, cols) {
  return Object.fromEntries(ZONES.map((z, i) => [z, [cut(rows, Math.floor(i / 3)), cut(rows, Math.floor(i / 3) + 1), cut(cols, i % 3), cut(cols, (i % 3) + 1)]]));
}

export function zoneOf(row, col, rows, cols) {
  for (const [z, [r0, r1, c0, c1]] of Object.entries(zoneBounds(rows, cols))) if (row >= r0 && row < r1 && col >= c0 && col < c1) return z;
  return 'C';
}
