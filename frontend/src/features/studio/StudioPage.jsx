import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, RotateCcw, Undo2, ArrowRight, Sparkles, Trees, House, Bus, Eraser, Brush, Camera, RotateCw, Locate } from 'lucide-react';
import { inr } from '../../shared/format.js';
import HeatGrid from '../../shared/HeatGrid.jsx';
import { HEAT_STOPS } from '../../shared/heatGrid.js';
import { MetricsBoard, MetricWhyModal, BottomSheet } from '../../shared/MetricsBoard.jsx';
import { Kicker, Pill, PillToggle, CircleBtn, Glass, Spinner, useToast } from '../../shared/UI.jsx';
import { useBlock } from '../../app/useBlock.js';
import { useSession } from '../../app/store.js';
import { toGrid } from '../../model/grid.js';
import { whyNot } from '../../model/rules.js';
import { useSimulation } from '../../model/useSimulation.js';
import AiSheet from './AiSheet.jsx';
import PhotoAuditPanel from '../photo/PhotoAuditPanel.jsx';
import Diorama from './diorama/Diorama.jsx';
import { buildingsOf } from './diorama/geometry.js';
import {
  MAX_TREES_PER_CELL, cellAt, coatedCells, fromCellPlacements, roofItem, stopItem, toCellPlacements, treeItem, treesInCell,
  withoutCell, withoutId, withoutNearest,
} from './placements.js';

const TOOLS = [
  { value: 'tree',       label: 'Tree',  icon: Trees },
  { value: 'cool_roof',  label: 'Roof',  icon: House },
  { value: 'shade_stop', label: 'Shade', icon: Bus },
  { value: 'erase',      label: 'Erase', icon: Eraser },
];
const VIEW_OPTS  = [{ value: false, label: 'Today' }, { value: true, label: 'With plan' }];
const LAYER_OPTS = [{ value: 'heat', label: 'Heat' }, { value: 'sat', label: 'Satellite' }];
const YEAR_OPTS  = [{ value: 1, label: 'Yr 1' }, { value: 10, label: 'Yr 10' }, { value: 20, label: 'Yr 20' }];
const ITEM_CAP = 5000;       // the API accepts at most 5000 placements
const PAINT_SPACING_M = 5;   // trees dropped while painting are at least this far apart

// zustand actions are stable references, so they can live outside the component and out of every dependency list
const { openBlock, setItems, undo, clear, setTool, setShowAfter, setYears, setBudget, beginStroke, strokeSet } = useSession.getState();

export default function StudioPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { block, error } = useBlock(id);

  const storeBlockId = useSession((s) => s.blockId);
  const items = useSession((s) => s.items);
  const tool = useSession((s) => s.tool);
  const showAfter = useSession((s) => s.showAfter);
  const years = useSession((s) => s.years);
  const budget = useSession((s) => s.budget);
  const canUndo = useSession((s) => s.history.length > 0);

  useEffect(() => { openBlock(id); }, [id]);   // a different place starts with an empty plan
  const ready = Boolean(block) && storeBlockId === id;

  const grid = useMemo(() => (block ? toGrid(block) : null), [block]);
  const cellPlacements = useMemo(() => (ready ? toCellPlacements(items) : []), [ready, items]);
  const sim = useSimulation(ready ? block : null, cellPlacements, years);

  const [layer, setLayer] = useState('heat');
  const [paint, setPaint] = useState(false);
  const [azimuth, setAzimuth] = useState(0);
  const [sat, setSat] = useState(null);
  const [flat, setFlat] = useState(false);          // WebGL unavailable: fall back to the 2D grid
  const [whyKey, setWhyKey] = useState(null);
  const [showAi, setShowAi] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const [wide, setWide] = useState(window.innerWidth >= 900);
  const view = useRef(null);
  const lastPaint = useRef(null);

  useEffect(() => {
    const on = () => setWide(window.innerWidth >= 900);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  useEffect(() => { if (tool !== 'tree') setPaint(false); }, [tool]);
  useEffect(() => { if (error) toast(error.message); }, [error, toast]);

  const buildings = useMemo(() => (grid && block ? buildingsOf(block, grid) : []), [block, grid]);
  const heatRange = useMemo(() => {
    if (!grid) return null;
    let lo = Infinity, hi = -Infinity;
    for (const v of grid.lst) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return [lo, hi];
  }, [grid]);

  // ── rules: what may go where (same rules the server enforces: model/rules.js) ─────────────
  const check = useCallback((t, current) => {
    if (!grid) return { valid: false };
    const { row, col } = cellAt(t.x, t.z, grid.cellM);
    if (tool === 'erase') return { valid: true };
    if (current.length >= ITEM_CAP) return { valid: false, reason: `That's the ${ITEM_CAP.toLocaleString()}-item limit for one plan` };
    if (tool === 'tree') {
      const why = whyNot(grid, 'tree', row, col);
      if (why) return { valid: false, reason: why };
      if (treesInCell(current, row, col) >= MAX_TREES_PER_CELL) return { valid: false, reason: `Cell is full (${MAX_TREES_PER_CELL} trees)` };
      return { valid: true };
    }
    if (tool === 'shade_stop') {
      const taken = new Set(current.filter((i) => i.type === 'shade_stop').map((i) => `shade_stop:${i.row}:${i.col}`));
      const why = whyNot(grid, 'shade_stop', row, col, taken);
      return why ? { valid: false, reason: why } : { valid: true };
    }
    if (!t.building) return { valid: false, reason: 'Tap a building roof' };
    const done = coatedCells(current);
    return t.building.cells.every(([r, c]) => done.has(`${r}:${c}`)) ? { valid: false, reason: 'Roof already coated' } : { valid: true };
  }, [grid, tool]);

  const erase = useCallback((t) => {
    const current = useSession.getState().items;
    let next;
    if (t.itemId) next = withoutId(current, t.itemId);                  // a tree or stop drawn under the cursor wins
    else if (t.building) {
      const cells = new Set(t.building.cells.map(([r, c]) => `${r}:${c}`));
      next = current.filter((it) => !(it.type === 'cool_roof' && it.cells.some(([r, c]) => cells.has(`${r}:${c}`))));
    } else if (t.x != null) next = withoutNearest(current, t.x, t.z, 6, grid.cellM);
    else return;
    if (next.length === current.length) return;
    setItems(next);
    toast('Removed');
  }, [grid, toast]);

  const place = useCallback((t) => {
    if (tool === 'erase') { erase(t); return; }
    const current = useSession.getState().items;
    const { valid, reason } = check(t, current);
    if (!valid) { toast(reason); return; }
    const m = grid.cellM;
    const item = tool === 'tree' ? treeItem(t.x, t.z, m) : tool === 'shade_stop' ? stopItem(t.x, t.z, m) : roofItem(t.building.cells, t.building.id);
    setItems([...current, item]);
    view.current?.ripple(t.x, t.z);
  }, [tool, check, grid, erase, toast]);

  const paintStart = useCallback(() => { if (tool === 'tree') { lastPaint.current = null; beginStroke(); } }, [tool]);
  const paintMove = useCallback((t) => {
    if (tool !== 'tree') return;
    const last = lastPaint.current;
    if (last && Math.hypot(t.x - last.x, t.z - last.z) < PAINT_SPACING_M) return;
    const current = useSession.getState().items;
    if (!check(t, current).valid) return;
    lastPaint.current = t;
    strokeSet([...current, treeItem(t.x, t.z, grid.cellM)]);
  }, [tool, check, grid]);

  // 2D fallback: the flat grid reports cells, we turn them into the same placement calls
  const tapCell = (row, col) => {
    const m = grid.cellM;
    const building = buildings.find((b) => b.cells.some(([r, c]) => r === row && c === col)) ?? null;
    place({ x: (col + 0.5) * m, z: (row + 0.5) * m, building });
    return true;
  };
  const longCell = (row, col) => { const cur = useSession.getState().items; const next = withoutCell(cur, row, col); if (next.length < cur.length) { setItems(next); toast('Removed'); } };

  // ── derived numbers ───────────────────────────────────────────────────────────
  const totalCost = Number(sim.metrics?.total_cost_inr ?? 0);
  const budgetPct = budget === 0 ? 0 : Math.min(1, totalCost / budget);
  const overBudget = totalCost > budget;
  const heatOpacity = layer === 'heat' ? 0.6 : 0;

  if (!ready || !grid) {
    return <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{error ? <Kicker color="var(--warn)">{error.message}</Kicker> : <Spinner />}</div>;
  }

  const blockName = block.name.replace(' (synthetic demo)', '');
  const live = block.conditions;
  const source = block.synthetic ? 'DEMO DATA' : 'SATELLITE DATA';
  const goReview = items.length ? () => navigate('/summary') : null;

  const topBar = (
    <div style={{ display: 'flex', alignItems: wide ? 'center' : 'flex-start', gap: 8, flexDirection: wide ? 'row' : 'column' }}>
      {!wide && (
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <CircleBtn icon={ArrowLeft} tooltip="Back" onClick={() => navigate('/')} />
          <div style={{ flex: 1 }} />
          <ActionBtns canUndo={canUndo} onUndo={undo} onStartOver={items.length ? clear : null} onSummary={goReview} />
        </div>
      )}
      {wide && <CircleBtn icon={ArrowLeft} tooltip="Back" onClick={() => navigate('/')} />}
      {wide && <div style={{ width: 14 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: wide ? 28 : 34, lineHeight: 1, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 460 }}>{blockName}</div>
        <div style={{ height: 4 }} />
        <div style={{ minHeight: 26, display: 'flex', alignItems: 'center' }}>
          {items.length === 0
            ? <span style={{ fontFamily: 'var(--font-hand)', fontSize: 21, color: 'var(--accent)', lineHeight: 1.05 }}>tap the ground to plant a tree</span>
            : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted)' }}>{items.length} ITEMS · YEAR {years} · {source}</span>}
        </div>
      </div>
      {wide && <ActionBtns canUndo={canUndo} onUndo={undo} onStartOver={items.length ? clear : null} onSummary={goReview} />}
    </div>
  );

  const controls = (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 150 }}><PillToggle options={VIEW_OPTS} value={showAfter} onChange={setShowAfter} dense expand /></div>
      <div style={{ flex: 1, minWidth: 150 }}><PillToggle options={LAYER_OPTS} value={layer} onChange={setLayer} dense expand /></div>
      <div style={{ flex: 1, minWidth: 150 }}><PillToggle options={YEAR_OPTS} value={years} onChange={setYears} dense expand /></div>
    </div>
  );

  const metricsPanel = <MetricsBoard metrics={sim.metrics} breakdown={sim.breakdown} heroSize={wide ? 34 : 28} stacked={wide} onInfo={setWhyKey} />;

  const budgetBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>BUDGET</span>
      <div style={{ flex: 1, height: 4, background: 'var(--rule)', borderRadius: 2, overflow: 'hidden' }}>
        <motion.div animate={{ width: `${budgetPct * 100}%` }} transition={{ duration: 0.65, ease: [0.2, 0.8, 0.2, 1] }} style={{ height: '100%', background: overBudget ? 'var(--warn)' : 'var(--accent)', borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: overBudget ? 'var(--warn)' : 'var(--ink)', whiteSpace: 'nowrap', minWidth: 118, textAlign: 'right' }}>{inr(totalCost)} / {inr(budget)}</span>
    </div>
  );

  const stage = flat ? (
    <HeatGrid block={block} placements={cellPlacements} cooling={sim.cooling} showAfter={showAfter} onTap={tapCell} onLongPress={longCell} />
  ) : (
    <div style={{ position: 'relative', width: '100%', height: wide ? '100%' : 'min(62dvh, 560px)', minHeight: 320 }}>
      <Diorama
        ref={view} block={block} grid={grid} items={items} years={years} tool={tool} paintMode={paint}
        cooling={sim.cooling} showAfter={showAfter} heatOpacity={heatOpacity}
        validate={(t) => check(t, items)} onPlace={place} onErase={erase}
        onPaintStart={paintStart} onPaint={paintMove} onPaintEnd={() => { lastPaint.current = null; }}
        onAzimuth={setAzimuth} onSatellite={setSat} onFallback={() => setFlat(true)}
      />
      {layer === 'heat' && heatRange && <HeatLegend lo={heatRange[0]} hi={heatRange[1]} />}
      <TurnControl azimuth={azimuth} onTurn={(a) => view.current?.setAzimuth(a)} onReset={() => view.current?.resetView()} />
      <div style={{ position: 'absolute', left: 12, bottom: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', pointerEvents: 'none', maxWidth: '60%' }}>
        {sat?.ok ? sat.copyright : sat?.error === 'no-key' ? 'Add VITE_GOOGLE_MAPS_API_KEY to show the real satellite photo' : sat?.ok === false && sat.error !== 'synthetic' ? 'Satellite photo unavailable, showing a painted map' : ''}
      </div>
    </div>
  );

  const dock = (
    <div style={{ padding: '12px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <Glass radius={30} padding="6px">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: wide ? 1 : '1 1 100%' }}><PillToggle options={TOOLS.map((t) => ({ value: t.value, label: t.label, icon: t.icon }))} value={tool} onChange={setTool} bare expand /></div>
            {/* secondary actions share a row on phones so nothing is cut off */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: wide ? '0 0 auto' : '1 1 100%', justifyContent: wide ? 'flex-end' : 'space-between' }}>
              {tool === 'tree' && !flat && <CircleBtn icon={Brush} tooltip={paint ? 'Painting: drag to plant (tap to stop)' : 'Paint trees by dragging'} onClick={() => setPaint((p) => !p)} filled={paint} />}
              <CircleBtn icon={Camera} tooltip="Check a street photo" onClick={() => setShowPhoto(true)} />
              <div style={{ flex: wide ? '0 0 auto' : 1 }}><Pill label="Ask AI" icon={Sparkles} height={44} expand={!wide} onClick={() => setShowAi(true)} /></div>
            </div>
          </div>
        </Glass>
      </div>
    </div>
  );

  const liveLine = live?.air_temp_c != null ? `Right now: ${Math.round(live.air_temp_c)} °C air${live.aqi ? ` · AQI ${live.aqi}` : ''}` : null;
  const note = (
    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
      {block.synthetic && block.kind === 'area' && (
        <><strong style={{ color: 'var(--warn)' }}>Not real data: </strong>the satellite service wasn't reachable, so this area is a synthetic stand-in. Numbers are for trying the tool only.<br /><br /></>
      )}
      {liveLine && <>{liveLine}<br /></>}
      {block.lst_period ? `Surface heat: hot-season satellite baseline (${block.lst_period}). ` : ''}
      Tap to place · hold or use Erase to remove · drag to turn and tilt · right-drag (two fingers) to move · scroll or pinch to zoom. Tap any number to see how it is calculated.
    </p>
  );

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {wide ? (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px var(--gutter) 14px' }}>{topBar}</div>
            <div style={{ padding: '0 var(--gutter) 12px' }}>{controls}</div>
            <div style={{ flex: 1, padding: '0 var(--gutter)', overflow: 'hidden', position: 'relative' }}>{stage}</div>
            {dock}
          </div>
          <div style={{ width: 380, borderLeft: '1px solid var(--rule)', overflowY: 'auto', padding: 24 }}>
            <Kicker>Live estimate</Kicker>
            <div style={{ height: 18 }} />
            {metricsPanel}
            <div style={{ height: 28 }} />
            {budgetBar}
            <div style={{ height: 28 }} />
            {note}
            {sim.error && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--warn)', marginTop: 12 }}>{sim.error}</p>}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <div style={{ padding: '8px var(--gutter) 16px' }}>{topBar}</div>
          <div style={{ padding: '0 var(--gutter)' }}>{metricsPanel}</div>
          <div style={{ padding: '14px var(--gutter)' }}>{budgetBar}</div>
          <div style={{ padding: '0 var(--gutter) 10px' }}>{controls}</div>
          <div style={{ padding: '0 12px' }}>{stage}</div>
          <div style={{ padding: '10px var(--gutter)' }}>{note}</div>
          {sim.error && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--warn)', padding: '8px var(--gutter)' }}>{sim.error}</p>}
        </div>
      )}
      {!wide && dock}

      <AnimatePresence>
        {whyKey && <MetricWhyModal metricKey={whyKey} metrics={sim.metrics} breakdown={sim.breakdown} onClose={() => setWhyKey(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showAi && (
          <AiSheet
            block={block} years={years} budget={budget} onBudget={setBudget}
            onApply={(pls) => { setItems(fromCellPlacements(pls, grid.cellM)); setShowAi(false); }}
            onClose={() => setShowAi(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showPhoto && (
          <BottomSheet onClose={() => setShowPhoto(false)}>
            <PhotoAuditPanel onClose={() => setShowPhoto(false)} onUseTool={(t) => { setTool(t); setShowPhoto(false); }} />
          </BottomSheet>
        )}
      </AnimatePresence>
    </div>
  );
}

/** What the heat colours mean: the area's own surface-temperature range (hot-season satellite baseline). */
function HeatLegend({ lo, hi }) {
  const bar = `linear-gradient(to right, ${HEAT_STOPS.map(([r, g, b]) => `rgb(${r},${g},${b})`).join(',')})`;
  return (
    <div style={{ position: 'absolute', left: 12, top: 10, pointerEvents: 'none' }}>
      <Glass radius={14} padding="9px 12px">
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--muted)', marginBottom: 6 }}>SURFACE HEAT · HOT SEASON</div>
        <div style={{ width: 170, height: 6, borderRadius: 3, background: bar }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink)', marginTop: 5 }}>
          <span>{lo.toFixed(1)} °C</span><span>{hi.toFixed(1)} °C</span>
        </div>
      </Glass>
    </div>
  );
}

/** Quick quarter turns and a reset; everything else is direct: drag to turn and tilt, right-drag to move, scroll to zoom. */
function TurnControl({ azimuth, onTurn, onReset }) {
  return (
    <div style={{ position: 'absolute', right: 12, bottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
      <CircleBtn icon={RotateCcw} tooltip="Turn left" onClick={() => onTurn(azimuth - Math.PI / 4)} />
      <CircleBtn icon={RotateCw} tooltip="Turn right" onClick={() => onTurn(azimuth + Math.PI / 4)} />
      <CircleBtn icon={Locate} tooltip="Reset view" onClick={onReset} />
    </div>
  );
}

function ActionBtns({ canUndo, onUndo, onStartOver, onSummary }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <CircleBtn icon={Undo2} tooltip="Undo" onClick={canUndo ? onUndo : undefined} disabled={!canUndo} />
      <CircleBtn icon={RotateCcw} tooltip="Start over" onClick={onStartOver ?? undefined} disabled={!onStartOver} />
      <div style={{ width: 2 }} />
      <motion.div animate={{ opacity: onSummary ? 1 : 0.4 }} transition={{ duration: 0.22 }}>
        <Pill label="Review" icon={ArrowRight} dense height={40} onClick={onSummary ?? undefined} disabled={!onSummary} />
      </motion.div>
    </div>
  );
}
