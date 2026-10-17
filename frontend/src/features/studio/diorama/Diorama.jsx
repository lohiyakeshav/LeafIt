import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { DioramaScene } from './DioramaScene.js';
import { buildingsOf } from './geometry.js';
import { paintGround } from '../../../shared/heatmap/landcover.js';
import { fetchSatellite, hasMapsKey } from '../../../api/mapTiles.js';

/**
 * The 3D view as a React component. It owns the three.js scene's lifecycle and forwards props to it; all game rules
 * (what may be placed where) stay in the parent through `validate` / `onPlace` / `onErase` / `onPaint`.
 *
 * Progressive reveal: painted ground + rising buildings show at once; the real satellite photo swaps in when it arrives.
 */
const Diorama = forwardRef(function Diorama({
  block, grid, items, years, tool, paintMode, cooling, showAfter, heatOpacity,
  validate, onPlace, onErase, onPaint, onPaintStart, onPaintEnd, onAzimuth, onSatellite, onFallback,
}, ref) {
  const host = useRef(null);
  const scene = useRef(null);
  const latest = useRef({});
  useLayoutEffect(() => { latest.current = { validate, onPlace, onErase, onPaint, onPaintStart, onPaintEnd, onAzimuth, onSatellite, onFallback }; });
  const buildings = useMemo(() => buildingsOf(block, grid), [block, grid]);

  useImperativeHandle(ref, () => ({
    ripple: (x, z) => scene.current?.ripple(x, z),
    resetView: () => scene.current?.resetView(),
    highlightZone: (z) => scene.current?.highlightZone(z),
    setAzimuth: (a) => scene.current?.setAzimuth(a),
    get drawCalls() { return scene.current?.drawCalls ?? 0; },
  }), []);

  // scene lifecycle
  useEffect(() => {
    let s;
    try {
      s = new DioramaScene(host.current, {
        onTap: (t) => latest.current.onPlace?.(t),
        onErase: (t) => latest.current.onErase?.(t),
        onPaint: (t) => latest.current.onPaint?.(t),
        onPaintStart: () => latest.current.onPaintStart?.(),
        onPaintEnd: () => latest.current.onPaintEnd?.(),
        onAzimuth: (a) => latest.current.onAzimuth?.(a),
        onHover: (t) => s?.setGhost(t ? { x: t.x, z: t.z, valid: latest.current.validate?.(t)?.valid ?? true } : null),
      });
    } catch (e) {
      latest.current.onFallback?.(e);
      return undefined;
    }
    scene.current = s;
    if (import.meta.env.DEV) window.__diorama = s;   // dev only: lets browser tests read renderer.info (draw calls, triangles)
    return () => { s.dispose(); scene.current = null; };
  }, []);

  // area: painted ground right away, then the satellite photo
  useEffect(() => {
    const s = scene.current;
    if (!s) return undefined;
    s.setArea({ grid, buildings, ground: paintGround(grid), ambientTrees: true });
    let alive = true;
    const abort = new AbortController();
    const b = block.bounds;
    if (b && hasMapsKey()) {
      fetchSatellite(b, { signal: abort.signal }).then(({ canvas, copyright }) => {
        if (!alive) return;
        s.setGroundImage(canvas, { satellite: true });
        latest.current.onSatellite?.({ ok: true, copyright });
      }).catch((e) => alive && latest.current.onSatellite?.({ ok: false, error: e.message }));
    } else {
      latest.current.onSatellite?.({ ok: false, error: 'no-key' });
    }
    return () => { alive = false; abort.abort(); };
  }, [block, grid, buildings]);

  useEffect(() => { scene.current?.setItems(items, years); }, [items, years, buildings]);
  useEffect(() => { scene.current?.setCooling(cooling, { showAfter, heatOpacity }); }, [cooling, showAfter, heatOpacity, buildings]);
  useEffect(() => { scene.current?.setTool(tool); }, [tool]);
  useEffect(() => { scene.current?.setPaintMode(paintMode); }, [paintMode]);

  // a soft pool of light under the slab, so it floats in the page instead of in a black void
  return <div ref={host} style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 55% at 50% 55%, rgba(158,227,95,0.07), rgba(158,227,95,0) 70%)' }} />;
});

export default Diorama;
