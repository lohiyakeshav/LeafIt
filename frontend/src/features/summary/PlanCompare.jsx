// Before / after on the real place: the satellite photo with the measured surface heat on top, and the plan's cooling.
// "Heat" view: drag the handle — left is today (Landsat), right is with the plan (heat minus the model's cooling, plus a
// cyan glow scaled to this plan so even small effects show). "Cooling" view: only what the plan changes, in °C.
import { useEffect, useMemo, useRef, useState } from 'react';
import { heatColor, drawPlacements, HEAT_STOPS } from '../../shared/heatmap/draw.js';
import { PillToggle } from '../../shared/ui';
import { fetchSatellite, hasMapsKey } from '../../api/mapTiles.js';
import { paintGround } from '../../shared/heatmap/landcover.js';
import { toGrid } from '../../model/grid.js';

const W = 1200;                                   // backing-store width; displayed at 100% of the card
const HEAT_CSS = `linear-gradient(to right, ${HEAT_STOPS.map(([r, g, b]) => `rgb(${r},${g},${b})`).join(',')})`;
const COOL_CSS = 'linear-gradient(to right, rgba(127,214,255,0.35), rgb(127,214,255), rgb(30,110,230))';
const VIEWS = [{ value: 'heat', label: 'Heat' }, { value: 'cooling', label: 'Cooling effect' }];

/** cols×rows image, one pixel per 10 m cell; drawn scaled with smoothing it becomes a soft field like the 3D view */
function cellImage(rows, cols, colorAt) {
  const c = document.createElement('canvas');
  c.width = cols; c.height = rows;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(cols, rows);
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const rgba = colorAt(r, k);
    if (rgba) img.data.set(rgba, (r * cols + k) * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export default function PlanCompare({ block, placements, cooling, years, maxMapHeight }) {
  const { rows, cols, lst } = block;
  const H = Math.round((W * rows) / cols);
  const [view, setView] = useState('heat');
  const [photo, setPhoto] = useState(null);      // { canvas, copyright } | { canvas: painted, painted: true }
  const [pos, setPos] = useState(0.5);
  const [hover, setHover] = useState(null);
  const before = useRef(), after = useRef(), coolRef = useRef(), wrap = useRef();

  // range of the measured heat, and the plan's strongest cooling (sets the glow scale)
  const { lo, hi } = useMemo(() => {
    let a = Infinity, b = -Infinity;
    for (const row of lst) for (const v of row) { if (v < a) a = v; if (v > b) b = v; }
    return { lo: a, hi: b };
  }, [lst]);
  const maxCool = useMemo(() => (cooling ? Math.max(0, ...cooling) : 0), [cooling]);
  // Log scale: a coated roof's own surface cools ~9 °C, a street tree ~0.3 °C. On a linear scale the trees vanish.
  const strength = (c) => (c <= 0.005 || maxCool <= 0.005 ? 0 : Math.min(1, Math.log1p(c / 0.05) / Math.log1p(maxCool / 0.05)));

  // the real photo (same Map Tiles source as the 3D view, usually already in the browser cache); painted map otherwise
  useEffect(() => {
    let alive = true;
    const painted = () => alive && setPhoto({ canvas: paintGround(toGrid(block)), painted: true });
    if (block.bounds && hasMapsKey()) fetchSatellite(block.bounds).then((p) => alive && setPhoto(p)).catch(painted);
    else painted();
    return () => { alive = false; };
  }, [block]);

  useEffect(() => {
    if (!photo) return;
    const span = Math.max(hi - lo, 0.1);
    const coolAt = (r, c) => (cooling ? cooling[r * cols + c] ?? 0 : 0);
    const heat = (withPlan) => cellImage(rows, cols, (r, c) => [...heatColor((lst[r][c] - (withPlan ? coolAt(r, c) : 0) - lo) / span), 255]);
    const glow = maxCool > 0.005 && cellImage(rows, cols, (r, c) => {
      const f = strength(coolAt(r, c));
      return f > 0.04 ? [127, 214, 255, Math.round(255 * (0.25 + 0.6 * f))] : null;
    });
    const ramp = maxCool > 0.005 && cellImage(rows, cols, (r, c) => {
      const f = strength(coolAt(r, c));
      if (f <= 0.03) return null;
      return [Math.round(127 - 97 * f), Math.round(214 - 104 * f), Math.round(255 - 25 * f), Math.round(255 * (0.3 + 0.65 * f))];
    });
    const items = document.createElement('canvas');
    items.width = W; items.height = H;
    drawPlacements(items, block, placements);

    const paint = (cv, layers) => {
      if (!cv) return;
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(photo.canvas, 0, 0, W, H);
      for (const [img, alpha] of layers) if (img) { ctx.globalAlpha = alpha; ctx.drawImage(img, 0, 0, W, H); }
      ctx.globalAlpha = 1;
    };
    const heatAlpha = photo.painted ? 0.8 : 0.55;
    paint(before.current, [[heat(false), heatAlpha]]);
    paint(after.current, [[heat(true), heatAlpha], [glow, 0.9], [items, 1]]);
    // cooling view: dim the photo slightly so the blue reads, then only the plan's effect
    paint(coolRef.current, [[cellImage(1, 1, () => [10, 14, 12, 255]), 0.35], [ramp, 1], [items, 1]]);
  }, [photo, cooling, block, placements, lst, rows, cols, lo, hi, maxCool, H, view]);   // eslint-disable-line react-hooks/exhaustive-deps

  // pointer → cell read-out (and the slider handle while dragging in heat view)
  const onMove = (e, drag) => {
    const r = wrap.current.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    if (drag && view === 'heat') setPos(Math.min(1, Math.max(0, fx)));
    const row = Math.floor(fy * rows), col = Math.floor(fx * cols);
    if (row < 0 || col < 0 || row >= rows || col >= cols) { setHover(null); return; }
    setHover({ x: fx, y: fy, t: lst[row][col], cool: cooling ? cooling[row * cols + col] ?? 0 : 0 });
  };
  const onKey = (e) => {   // the handle is keyboard-operable
    if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 0.05));
    if (e.key === 'ArrowRight') setPos((p) => Math.min(1, p + 0.05));
  };

  const cv = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
  return (
    // the figure narrows so the map never grows taller than maxMapHeight (keeps the page above the fold)
    <figure style={{ margin: 0, width: maxMapHeight ? `min(100%, calc((${maxMapHeight}) * ${cols / rows}))` : '100%' }}>
      <div data-noprint style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ width: 260 }}><PillToggle options={VIEWS} value={view} onChange={setView} dense expand /></div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
          {view === 'heat' ? 'Drag the handle · point anywhere for the reading' : `Point anywhere for the reading · year ${years}`}
        </span>
      </div>

      <div ref={wrap}
        style={{ position: 'relative', aspectRatio: `${cols} / ${rows}`, borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--rule)', background: 'var(--sunk)', cursor: view === 'heat' ? 'col-resize' : 'crosshair', touchAction: 'pan-y', userSelect: 'none' }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onMove(e, true); }}
        onPointerMove={(e) => onMove(e, e.buttons > 0)}
        onPointerLeave={() => setHover(null)}>
        {view === 'heat' ? (
          <>
            <canvas ref={before} width={W} height={H} style={cv} aria-hidden="true" />
            <canvas ref={after} width={W} height={H} style={{ ...cv, clipPath: `inset(0 0 0 ${pos * 100}%)` }} aria-hidden="true" />
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pos * 100}%`, width: 2, background: '#fff', transform: 'translateX(-1px)', pointerEvents: 'none', boxShadow: '0 0 8px rgba(0,0,0,0.5)' }} />
            <div role="slider" tabIndex={0} aria-label="Compare today with the plan" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos * 100)} onKeyDown={onKey}
              style={{ position: 'absolute', top: '50%', left: `${pos * 100}%`, transform: 'translate(-50%, -50%)', width: 42, height: 42, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 18px rgba(0,0,0,0.45)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#141815" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
            </div>
            <Tag style={{ left: 10 }}>TODAY · MEASURED</Tag>
            <Tag style={{ right: 10 }} accent>WITH PLAN · YEAR {years}</Tag>
          </>
        ) : (
          <>
            <canvas ref={coolRef} width={W} height={H} style={cv} aria-label="Map of the cooling this plan adds" role="img" />
            <Tag style={{ left: 10 }} accent>COOLING FROM THIS PLAN</Tag>
          </>
        )}
        {hover && (
          <div style={{ position: 'absolute', left: `${hover.x * 100}%`, top: `${hover.y * 100}%`, transform: `translate(${hover.x > 0.7 ? 'calc(-100% - 14px)' : '14px'}, -50%)`, pointerEvents: 'none', background: 'rgba(14,17,15,0.88)', color: '#E8EDE3', borderRadius: 10, padding: '7px 10px', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5, whiteSpace: 'nowrap' }}>
            <div>Today {hover.t.toFixed(1)} °C</div>
            {hover.cool > 0.005
              ? <div style={{ color: '#7FD6FF' }}>With plan {(hover.t - hover.cool).toFixed(1)} °C (−{hover.cool.toFixed(2)})</div>
              : <div style={{ color: '#8C9589' }}>No change here</div>}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)' }}>{view === 'heat' ? `${lo.toFixed(1)}°` : '0°'}</span>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: view === 'heat' ? HEAT_CSS : COOL_CSS }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
          {view === 'heat' ? `${hi.toFixed(1)}° surface` : `−${maxCool.toFixed(1)}° cooler (log scale)`}
        </span>
      </div>
      <figcaption style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.6, color: 'var(--muted)' }}>
        Heat: Landsat 8/9 surface temperature, hot-season median{block.lst_period ? ` (${block.lst_period})` : ''}
        {' '}· Cooling: LeafIt model estimate · {photo?.painted ? 'Painted land-cover map' : photo?.copyright ?? 'Loading photo…'}
      </figcaption>
    </figure>
  );
}

function Tag({ children, accent, style }) {
  return (
    <div style={{ position: 'absolute', top: 10, pointerEvents: 'none', padding: '5px 10px', borderRadius: 999, background: 'rgba(14,17,15,0.78)', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: accent ? '#9EE35F' : '#E8EDE3', ...style }}>
      {children}
    </div>
  );
}
