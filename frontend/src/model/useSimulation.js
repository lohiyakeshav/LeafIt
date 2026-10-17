import { useEffect, useMemo, useRef, useState } from 'react';
import { toGrid } from './grid.js';
import { simulate } from './sim.js';

const EMPTY = { metrics: null, breakdown: null, cooling: null, error: null };
const HAS_WORKER = typeof Worker !== 'undefined';

/**
 * Live estimate for `placements` (cell-form) on `block`, computed in a Web Worker on every change: no debounce, no network.
 * Falls back to the main thread where workers are unavailable. Returns { metrics, breakdown, cooling (flat Float32Array), error }.
 */
export function useSimulation(block, placements, years, unitCost = null) {
  const grid = useMemo(() => (block ? toGrid(block) : null), [block]);
  const [result, setResult] = useState({ grid: null, ...EMPTY });
  const workerRef = useRef(null);
  const seq = useRef(0);
  const gridRef = useRef(null);

  useEffect(() => {
    if (!HAS_WORKER) return undefined;
    const worker = new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.seq !== seq.current) return; // an older answer arriving late
      if (data.type === 'result') setResult({ grid: gridRef.current, metrics: data.metrics, breakdown: data.breakdown, cooling: data.cooling, error: null });
      else setResult((r) => ({ ...r, grid: gridRef.current, error: data.message }));
    };
    workerRef.current = worker;
    return () => { worker.terminate(); workerRef.current = null; };
  }, []);

  useEffect(() => {
    gridRef.current = grid;
    if (grid) workerRef.current?.postMessage({ type: 'init', grid });
  }, [grid]);

  useEffect(() => {
    if (grid && HAS_WORKER) workerRef.current?.postMessage({ type: 'run', seq: ++seq.current, placements, years, unitCost });
  }, [grid, placements, years, unitCost]);

  // No Worker (tests, very old browsers): compute on the main thread during render instead
  const inline = useMemo(() => {
    if (HAS_WORKER || !grid) return null;
    try {
      const out = simulate(grid, placements, years, unitCost);
      return { grid, metrics: out.metrics, breakdown: out.breakdown, cooling: out.cooling, error: null };
    } catch (e) {
      return { ...EMPTY, grid, error: e.message };
    }
  }, [grid, placements, years, unitCost]);

  const current = inline ?? result;
  return current.grid === grid ? current : EMPTY;  // numbers computed for another block are never shown
}
