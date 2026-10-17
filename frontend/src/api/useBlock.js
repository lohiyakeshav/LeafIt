import { useEffect, useState } from 'react';
import { endpoints } from './endpoints.js';
import { parseBlock } from '../shared/heatmap/draw.js';

const cache = new Map(); // id -> Promise<block>: a block (or area) never changes for a given id, so fetch it once per session

export function loadBlock(id) {
  if (!cache.has(id)) {
    cache.set(id, endpoints.getBlock(id).then(parseBlock).catch((e) => { cache.delete(id); throw e; }));
  }
  return cache.get(id);
}

/** Forget a cached block (a rebuilt area, e.g. one first built while OpenStreetMap was down, replaces it under the same id). */
export const forgetBlock = (id) => cache.delete(id);

/** { block, error } for a block/area id; block is null while loading. */
export function useBlock(id) {
  const [state, setState] = useState({ id: null, block: null, error: null });
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    loadBlock(id).then((block) => alive && setState({ id, block, error: null }), (error) => alive && setState({ id, block: null, error }));
    return () => { alive = false; };
  }, [id]);
  return state.id === id ? state : { id, block: null, error: null };
}
