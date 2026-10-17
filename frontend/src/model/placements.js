// What the user has placed, in two views of the same data:
//   items        individual things with exact positions (metres from the area's NW corner) for the 3D view
//   cell-form    {type,row,col,count} per 10 m cell, which is what the simulators and the backend understand
// Pure functions only, so they're unit-tested without a browser.
import { RULES } from './rules.js';

export const MAX_TREES_PER_CELL = RULES.tree.max_count_per_cell;

let seed = 0;
const uid = () => `${Date.now().toString(36)}${(seed++).toString(36)}`;
export const cellAt = (x, z, cellM) => ({ row: Math.floor(z / cellM), col: Math.floor(x / cellM) });

export const treeItem = (x, z, cellM) => ({ id: uid(), type: 'tree', x, z, ...cellAt(x, z, cellM) });
export const stopItem = (x, z, cellM) => ({ id: uid(), type: 'shade_stop', x, z, ...cellAt(x, z, cellM) });
/** A roof covers every cell its building overlaps (the model works per cell). */
export const roofItem = (cells, buildingId = null) => ({ id: uid(), type: 'cool_roof', cells, buildingId, row: cells[0][0], col: cells[0][1] });

const key = (r, c) => `${r}:${c}`;
const cellsOf = (it) => (it.type === 'cool_roof' ? it.cells : [[it.row, it.col]]);

export function treesInCell(items, row, col) {
  let n = 0;
  for (const it of items) if (it.type === 'tree' && it.row === row && it.col === col) n++;
  return n;
}

/** items -> [{type,row,col,count}]: trees summed per cell, roofs and stops once per cell. */
export function toCellPlacements(items) {
  const trees = new Map();
  const once = { cool_roof: new Set(), shade_stop: new Set() };
  const out = [];
  for (const it of items) {
    if (it.type === 'tree') {
      const k = key(it.row, it.col);
      const p = trees.get(k);
      if (p) p.count = Math.min(p.count + 1, MAX_TREES_PER_CELL);
      else { const np = { type: 'tree', row: it.row, col: it.col, count: 1 }; trees.set(k, np); out.push(np); }
    } else {
      for (const [r, c] of cellsOf(it)) {
        const k = key(r, c);
        if (!once[it.type].has(k)) { once[it.type].add(k); out.push({ type: it.type, row: r, col: c, count: 1 }); }
      }
    }
  }
  return out;
}

/** Cells that currently have a coated roof (the 3D view whitens buildings that touch one). */
export function coatedCells(items) {
  const s = new Set();
  for (const it of items) if (it.type === 'cool_roof') for (const [r, c] of it.cells) s.add(key(r, c));
  return s;
}

/** Deterministic spot inside a cell, so the same plan always looks the same (agent plans, reloads). */
function jitter(row, col, k) {
  let a = (row * 7919 + col * 104729 + k * 13 + 1) >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return [0.15 + 0.7 * next(), 0.15 + 0.7 * next()];
}

/** [{type,row,col,count}] (agent plans, saved plans) -> items with positions. */
export function fromCellPlacements(placements, cellM) {
  const items = [];
  for (const p of placements) {
    if (p.type === 'tree') {
      for (let k = 0; k < (p.count ?? 1); k++) {
        const [fx, fz] = jitter(p.row, p.col, k);
        items.push(treeItem((p.col + fx) * cellM, (p.row + fz) * cellM, cellM));
      }
    } else if (p.type === 'cool_roof') items.push(roofItem([[p.row, p.col]]));
    else items.push(stopItem((p.col + 0.5) * cellM, (p.row + 0.5) * cellM, cellM));
  }
  return items;
}

/** Remove everything in a cell (what long-press / right-click means in the 2D grid). */
export const withoutCell = (items, row, col) => items.filter((it) => !cellsOf(it).some(([r, c]) => r === row && c === col));

/** Remove one item by id (what the 3D view's screen-space picking reports). */
export const withoutId = (items, id) => items.filter((it) => it.id !== id);

/** Remove the single item nearest to (x, z) within `radius` metres; roofs match through any of their cells. */
export function withoutNearest(items, x, z, radius, cellM) {
  let best = -1, bestD = radius * radius;
  items.forEach((it, i) => {
    const pts = it.type === 'cool_roof' ? it.cells.map(([r, c]) => [(c + 0.5) * cellM, (r + 0.5) * cellM]) : [[it.x ?? (it.col + 0.5) * cellM, it.z ?? (it.row + 0.5) * cellM]];
    for (const [px, pz] of pts) { const d = (px - x) ** 2 + (pz - z) ** 2; if (d < bestD) { bestD = d; best = i; } }
  });
  return best < 0 ? items : items.filter((_, i) => i !== best);
}

export const countItems = (items) => items.length;
