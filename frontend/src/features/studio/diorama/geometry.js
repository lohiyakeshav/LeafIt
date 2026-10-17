// Pure geometry for the diorama (no three.js here, so it is unit-tested without a GPU).
// World axes: x = east, z = south, y = up, in metres from the area's north-west corner, matching backend/app/domain/area/grid.py.

const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Sutherland–Hodgman: the part of `poly` inside [0,W]×[0,D]. Footprints that straddle the area edge must not hang off the slab. */
export function clipToRect(poly, W, D) {
  const edges = [
    [(p) => p[0] >= 0, (a, b) => { const t = (0 - a[0]) / (b[0] - a[0]); return [0, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[0] <= W, (a, b) => { const t = (W - a[0]) / (b[0] - a[0]); return [W, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[1] >= 0, (a, b) => { const t = (0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), 0]; }],
    [(p) => p[1] <= D, (a, b) => { const t = (D - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), D]; }],
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    if (!out.length) break;
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cut(prev, cur));
    }
  }
  return out;
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

/** Cells (the model's unit) that a footprint touches and that actually hold roof: where the model will cool it. */
export function cellsForPolygon(poly, { rows, cols, cellM, bf }) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const cells = [];
  for (let r = Math.max(0, Math.floor(z0 / cellM)); r <= Math.min(rows - 1, Math.floor(z1 / cellM)); r++)
    for (let c = Math.max(0, Math.floor(x0 / cellM)); c <= Math.min(cols - 1, Math.floor(x1 / cellM)); c++)
      if (bf[r * cols + c] > 0) cells.push([r, c]);
  return cells;
}

/**
 * [{id, height, poly:[[x,z]...], cells}] for a block. Real areas carry footprints + heights from the backend;
 * the synthetic demo block has only a coverage grid, so each roofed cell becomes a box (deterministic, so it never "jumps").
 */
export function buildingsOf(block, grid) {
  const { rows, cols, cellM } = grid;
  if (block.buildings?.length) {
    const W = cols * cellM, D = rows * cellM;
    return block.buildings
      .map((b) => ({ id: b.id, height: b.height_m, poly: clipToRect(b.poly, W, D) }))
      .filter((b) => b.poly.length >= 3 && polygonArea(b.poly) >= 4)          // slivers left by the clip aren't worth drawing
      .map((b) => ({ ...b, cells: cellsForPolygon(b.poly, grid) }))
      .filter((b) => b.cells.length);
  }
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const f = grid.bf[r * cols + c];
      if (f < 0.15) continue;
      const half = Math.max(2.5, cellM * 0.5 * Math.sqrt(f) * 0.92);
      const cx = (c + 0.5) * cellM, cz = (r + 0.5) * cellM;
      out.push({
        id: `g${r}_${c}`, height: 4 + 6 * f + 5 * hash(r, c),
        poly: [[cx - half, cz - half], [cx + half, cz - half], [cx + half, cz + half], [cx - half, cz + half]],
        cells: [[r, c]],
      });
    }
  }
  return out;
}

/** Spatial index: per 10 m cell, which buildings' bounding boxes touch it. */
export function buildIndex(buildings, { rows, cols, cellM }) {
  const cellsOf = new Array(rows * cols);
  buildings.forEach((b, i) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of b.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let r = Math.max(0, Math.floor(z0 / cellM)); r <= Math.min(rows - 1, Math.floor(z1 / cellM)); r++)
      for (let c = Math.max(0, Math.floor(x0 / cellM)); c <= Math.min(cols - 1, Math.floor(x1 / cellM)); c++)
        (cellsOf[r * cols + c] ??= []).push(i);
  });
  return { cellsOf, rows, cols, cellM };
}

/** Building whose footprint contains (x, z) and whose roof is at least height `y`; the tallest wins. null if none. */
export function buildingAt(index, buildings, x, z, y = 0) {
  const r = Math.floor(z / index.cellM), c = Math.floor(x / index.cellM);
  if (r < 0 || c < 0 || r >= index.rows || c >= index.cols) return null;
  let best = null;
  for (const i of index.cellsOf[r * index.cols + c] ?? []) {
    const b = buildings[i];
    if (b.height >= y && pointInPolygon(x, z, b.poly) && (best === null || b.height > buildings[best].height)) best = i;
  }
  return best;
}

/**
 * Which building (if any) the pointer ray hits, without raycasting hundreds of thousands of triangles.
 * `origin`/`dir` are the ray in area coordinates; we walk it downwards in 1.5 m steps and test the footprint index.
 */
export function pickBuilding(index, buildings, origin, dir, maxHeight) {
  if (dir.y >= -1e-6) return null;
  const startT = (origin.y - maxHeight) / -dir.y;
  const endT = origin.y / -dir.y;
  const step = 1.5 / Math.max(1e-6, Math.abs(dir.y));
  for (let t = Math.max(0, startT); t <= endT + step; t += step) {
    const y = origin.y + dir.y * t;
    const hit = buildingAt(index, buildings, origin.x + dir.x * t, origin.z + dir.z * t, Math.max(0, y));
    if (hit !== null) return hit;
  }
  return null;
}

/** Where a pointer ray meets the ground (y = 0), or null if it points at the sky. */
export function groundHit(origin, dir) {
  if (dir.y >= -1e-6) return null;
  const t = origin.y / -dir.y;
  return { x: origin.x + dir.x * t, z: origin.z + dir.z * t };
}
