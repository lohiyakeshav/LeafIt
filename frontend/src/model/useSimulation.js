import { useEffect, useMemo, useRef, useState } from 'react';
import { toGrid } from './grid.js';
import { simulate } from './sim.js';

const EMPTY = { metrics: null, breakdown: null, cooling: null, error: null };

/**
 * Live estimate for `placements` (cell-form) on `block`, computed in a Web Worker on every change: no debounce, no network.
 * Falls back to the main thread where workers are unavailable. Returns { metrics, breakdown, cooling (flat Float32Array), error }.
 */
export function useSimulation(block, placements, years) {
  const grid = useMemo(() => (block ? toGrid(block) : null), [block]);
  const [result, setResult] = useState({ grid: null, ...EMPTY });
  const workerRef = useRef(null);
  const seq = useRef(0);
  const gridRef = useRef(null);

  useEffect(() => {
    if (typeof Worker === 'undefined') return undefined;
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
    if (!grid) return;
    const id = ++seq.current;
    if (workerRef.current) { workerRef.current.postMessage({ type: 'run', seq: id, placements, years }); return; }
    try {
      const out = simulate(grid, placements, years);
      setResult({ grid, metrics: out.metrics, breakdown: out.breakdown, cooling: out.cooling, error: null });
    } catch (e) {
      setResult((r) => ({ ...r, grid, error: e.message }));
    }
  }, [grid, placements, years]);

  return result.grid === grid ? result : EMPTY;  // numbers computed for another block are never shown
}
