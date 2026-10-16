// Runs the simulator off the main thread. Latest request wins: if the user paints faster than we compute, stale
// requests are dropped, so the UI never queues up work or blocks the 3D view.
import { simulate } from './sim.js';

let grid = null;
let latest = null;
let scheduled = false;

function flush() {
  scheduled = false;
  const job = latest;
  latest = null;
  if (!job || !grid) return;
  try {
    const out = simulate(grid, job.placements, job.years);
    self.postMessage({ type: 'result', seq: job.seq, ...out }, [out.cooling.buffer]);
  } catch (e) {
    self.postMessage({ type: 'error', seq: job.seq, message: e.message });
  }
}

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    grid = data.grid;
    latest = null;
  } else if (data.type === 'run') {
    latest = data;
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0); // lets already-queued messages arrive first, so we compute only the newest
    }
  }
};
