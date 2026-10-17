// The Studio: place trees, cool roofs and shaded bus stops on the 3D twin and watch the live estimate.
// This file owns the page's state and rules (what may go where); presentation pieces live in ./components.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, RotateCcw, Undo2, ArrowRight, Sparkles, Brush } from 'lucide-react';
import { inr } from '../../shared/lib/format.js';
import { decodePlan } from '../../shared/lib/share.js';
import HeatGrid from '../../shared/heatmap/HeatGrid.jsx';
import { ImpactPanel } from '../../shared/metrics/ImpactPanel.jsx';
import { MetricWhyModal } from '../../shared/metrics/MetricWhyModal.jsx';
import { Dialog, Kicker, Pill, PillToggle, CircleBtn, Spinner, ThemeToggle, CurrencyPicker, LABEL, useToast } from '../../shared/ui';
import { useBlock } from '../../api/useBlock.js';
import { useSession } from '../../state/session.js';
import { toGrid } from '../../model/grid.js';
import { whyNot } from '../../model/rules.js';
import { useSimulation } from '../../model/useSimulation.js';
import AiSheet from './AiSheet.jsx';
import { TOOLS, VIEW_OPTS, LAYER_OPTS, YEAR_OPTS, ITEM_CAP, PAINT_SPACING_M, DEFAULT_BUDGET } from './config.js';
import { ToolCard, ExtraBtn } from './components/ToolCard.jsx';
import { HeatLegend, TurnControl } from './components/StageOverlays.jsx';
import { PlanOptions, CompareTable } from './components/PlanOptions.jsx';
import { CostsPanel } from './components/CostsPanel.jsx';
import Diorama from './diorama/Diorama.jsx';
import { buildingsOf } from './diorama/geometry.js';
import {
  MAX_TREES_PER_CELL, cellAt, fromCellPlacements, roofItem, stopItem, toCellPlacements, treeItem, treesInCell,
  withoutCell, withoutId, withoutNearest,
} from '../../model/placements.js';

// zustand actions are stable references, so they can live outside the component and out of every dependency list
const { openBlock, setItems, undo, clear, setTool, setShowAfter, setYears, setBudget, setUnitCost, beginStroke, strokeSet, saveOption, loadOption, removeOption } = useSession.getState();

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
  const userPrices = useSession((s) => s.unitCost);
  const canUndo = useSession((s) => s.history.length > 0);
  const options = useSession((s) => s.options);

  useEffect(() => { openBlock(id); }, [id]);   // a different place starts with an empty plan
  const ready = Boolean(block) && storeBlockId === id;

  const grid = useMemo(() => (block ? toGrid(block) : null), [block]);

  // A shared link carries the plan in ?plan=…: place it once the area is ready, then tidy the URL.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const code = params.get('plan');
    if (!ready || !grid || !code) return;
    decodePlan(code).then((d) => {
      if (d) {
        setItems(d.packed.map(([k, a, b]) => (k === 'r' ? roofItem(b, a) : (k === 't' ? treeItem : stopItem)(a, b, grid.cellM))));
        if (d.years) setYears(d.years);
        toast('Shared plan loaded');
      } else toast('That share link is damaged');
      setParams({}, { replace: true });
    });
  }, [ready, grid]);   // eslint-disable-line react-hooks/exhaustive-deps

  const cellPlacements = useMemo(() => (ready ? toCellPlacements(items) : []), [ready, items]);
  const sim = useSimulation(ready ? block : null, cellPlacements, years, userPrices);

  const [layer, setLayer] = useState('heat');
  const [paint, setPaint] = useState(false);
  const [azimuth, setAzimuth] = useState(0);
  const [sat, setSat] = useState(null);
  const [flat, setFlat] = useState(false);          // WebGL unavailable: fall back to the 2D grid
  const [whyKey, setWhyKey] = useState(null);
  const [showAi, setShowAi] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [wide, setWide] = useState(window.innerWidth >= 1000);
  const view = useRef(null);
  const lastPaint = useRef(null);

  useEffect(() => {
    const on = () => setWide(window.innerWidth >= 1000);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  // Keyboard: T / R / B / E pick a tool, ⌘Z or Ctrl+Z undoes (not while typing in a field)
  useEffect(() => {
    const keys = { t: 'tree', r: 'cool_roof', b: 'shade_stop', e: 'erase' };
    const on = (e) => {
      if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && keys[e.key.toLowerCase()]) setTool(keys[e.key.toLowerCase()]);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
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
    if (tool !== 'cool_roof' && t.onRoof) return { valid: false, reason: tool === 'tree' ? 'That’s a rooftop: trees go on the ground' : 'That’s a rooftop: bus stops go on roads' };
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
    return current.some((i) => i.type === 'cool_roof' && i.buildingId === t.building.id) ? { valid: false, reason: 'Roof already coated' } : { valid: true };
  }, [grid, tool]);

  const erase = useCallback((t) => {
    const current = useSession.getState().items;
    let next;
    if (t.itemId) next = withoutId(current, t.itemId);                  // a tree or stop drawn under the cursor wins
    else if (t.building) {
      const cells = new Set(t.building.cells.map(([r, c]) => `${r}:${c}`));
      // erase this building's coat; AI-plan coats (no building id) go by cell
      next = current.filter((it) => !(it.type === 'cool_roof' && (it.buildingId != null ? it.buildingId === t.building.id : it.cells.some(([r, c]) => cells.has(`${r}:${c}`)))));
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
  const heatOpacity = layer === 'heat' ? 0.6 : 0;

  if (!ready || !grid) {
    return <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{error ? <Kicker color="var(--warn)">{error.message}</Kicker> : <Spinner />}</div>;
  }

  const blockName = block.name.replace(' (synthetic demo)', '');
  const live = block.conditions;
  const source = block.synthetic ? 'SYNTHETIC STAND-IN' : 'SATELLITE DATA';
  const goReview = items.length ? () => navigate('/summary') : null;

  const title = (
    <div style={{ flex: 1, minWidth: 0 }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: wide ? 30 : 26, lineHeight: 1, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{blockName}</h1>
      <div style={{ ...LABEL, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {items.length === 0 ? 'NOTHING PLACED YET' : `${items.length} ITEMS`} · {source}
      </div>
    </div>
  );

  // Wide: one row. Phone: buttons on top, full-width title below so it never truncates.
  const header = (
    <header style={{ display: 'flex', flexWrap: wide ? 'nowrap' : 'wrap', alignItems: 'center', gap: wide ? 16 : 10, padding: wide ? '18px 32px' : '10px var(--gutter) 14px', borderBottom: '1px solid var(--rule)' }}>
      <CircleBtn icon={ArrowLeft} tooltip="Back" onClick={() => navigate('/')} />
      {wide ? title : <div style={{ flex: 1 }} />}
      <CircleBtn icon={Undo2} tooltip="Undo" onClick={canUndo ? undo : undefined} disabled={!canUndo} />
      <CircleBtn icon={RotateCcw} tooltip="Start over" onClick={items.length ? clear : undefined} disabled={!items.length} />
      <CurrencyPicker />
      {wide && <ThemeToggle />}   {/* on phones the header is full; the toggle lives on Home, Explore and Summary */}
      {wide && <Pill label="Ask AI to plan" icon={Sparkles} kind="outline" dense height={40} onClick={() => setShowAi(true)} />}
      <Pill label="Review" icon={ArrowRight} dense height={40} onClick={goReview ?? undefined} disabled={!goReview} />
      {!wide && <div style={{ flexBasis: '100%', display: 'flex' }}>{title}</div>}
    </header>
  );

  const toolCards = TOOLS.map((t) => (
    <ToolCard key={t.value} tool={t} active={tool === t.value} compact={!wide} onClick={() => setTool(t.value)} />
  ));

  const viewControls = (
    <>
      <PillToggle options={VIEW_OPTS} value={showAfter} onChange={setShowAfter} dense expand />
      <PillToggle options={LAYER_OPTS} value={layer} onChange={setLayer} dense expand />
      <PillToggle options={YEAR_OPTS} value={years} onChange={setYears} dense expand />
    </>
  );

  const canPaint = tool === 'tree' && !flat;
  const painting = paint && canPaint;   // switching tool simply stops painting; no effect needed
  const extras = (
    <>
      {canPaint && <ExtraBtn icon={Brush} label={painting ? 'Painting…' : 'Paint trees'} active={painting} onClick={() => setPaint((p) => !p)} compact />}
    </>
  );

  const stage = flat ? (
    <div style={{ height: '100%', containerType: 'size' }}>
      <HeatGrid block={block} placements={cellPlacements} cooling={sim.cooling} showAfter={showAfter} onTap={tapCell} onLongPress={longCell}
        isValid={tool === 'erase' ? null : (r, c) => !whyNot(grid, tool, r, c)} />
    </div>
  ) : (
    <div style={{ position: 'relative', width: '100%', height: wide ? '100%' : 'min(62dvh, 560px)', minHeight: 320, borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--rule)', background: 'var(--sunk)' }}>
      <Diorama
        ref={view} block={block} grid={grid} items={items} years={years} tool={tool} paintMode={painting}
        cooling={sim.cooling} showAfter={showAfter} heatOpacity={heatOpacity}
        validate={(t) => check(t, items)} onPlace={place} onErase={erase}
        onPaintStart={paintStart} onPaint={paintMove} onPaintEnd={() => { lastPaint.current = null; }}
        onAzimuth={setAzimuth} onSatellite={setSat} onFallback={() => setFlat(true)}
      />
      {layer === 'heat' && heatRange && <HeatLegend lo={heatRange[0]} hi={heatRange[1]} />}
      <TurnControl azimuth={azimuth} onTurn={(a) => view.current?.setAzimuth(a)} onReset={() => view.current?.resetView()} />
      <div style={{ position: 'absolute', left: 12, bottom: 10, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', pointerEvents: 'none', maxWidth: '60%' }}>
        {sat?.ok ? sat.copyright : sat?.error === 'no-key' ? 'Add VITE_GOOGLE_MAPS_API_KEY to show the real satellite photo' : sat?.ok === false && sat.error !== 'synthetic' ? 'Satellite photo unavailable, showing a painted map' : ''}
      </div>
    </div>
  );

  const costsPanel = (
    <CostsPanel unitCost={userPrices} budget={budget} compact={!wide}
      onPrice={(t, v) => setUnitCost({ ...(userPrices ?? {}), [t]: v })} onBudget={setBudget}
      onReset={() => { setUnitCost(null); setBudget(DEFAULT_BUDGET); toast('Prices and budget reset'); }} />
  );

  const optionsPanel = (
    <PlanOptions options={options} canSave={items.length > 0 && Boolean(sim.metrics) && !options.some((o) => o.items === items)}
      onSave={() => { saveOption(sim.metrics); toast('Saved: keep editing, then compare'); }}
      onLoad={(o) => { loadOption(o.id); toast(`${o.label} loaded`); }} onRemove={(o) => removeOption(o.id)} onCompare={() => setShowCompare(true)} />
  );

  const impact = (
    <ImpactPanel metrics={sim.metrics} breakdown={sim.breakdown} budget={budget} years={years} compact={!wide} onInfo={setWhyKey} />
  );

  const aqiText = live?.aqi ? ` · AQI ${live.aqi}${live.aqi_source === 'default' ? ' (Delhi default, no live reading)' : ''}` : '';
  const liveLine = live?.air_temp_c != null ? `Right now: ${Math.round(live.air_temp_c)} °C air${aqiText}` : null;
  const note = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>
      {block.synthetic && block.kind === 'area' && (
        <p><strong style={{ color: 'var(--warn)' }}>Not real data: </strong>the satellite service wasn't reachable, so this area is a synthetic stand-in. Numbers are for trying the tool only.</p>
      )}
      {liveLine && <p>{liveLine}</p>}
      {block.lst_period && <p>Surface heat: hot-season satellite baseline ({block.lst_period}).</p>}
      {sim.error && <p style={{ color: 'var(--warn)' }}>{sim.error}</p>}
    </div>
  );

  const help = (
    <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>
      Tap to place; the cursor turns red where an item can't go. Drag to turn and tilt, right-drag to move, scroll to zoom.
      {wide && <> Keys: <kbd>T</kbd> tree · <kbd>R</kbd> roof · <kbd>B</kbd> bus stop · <kbd>E</kbd> erase · <kbd>⌘Z</kbd> undo.</>}
    </p>
  );

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {header}
      {wide ? (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) clamp(380px, 32vw, 460px)' }}>
          {/* Workbench: tools on the left, 3D stage on the right */}
          <section style={{ minHeight: 0, display: 'grid', gridTemplateColumns: '208px minmax(0, 1fr)', gap: 24, padding: '24px 32px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflowY: 'auto' }}>
              <div style={{ ...LABEL, marginBottom: 2 }}>PLACE</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{toolCards}</div>
              <div style={{ display: 'flex', gap: 6 }}>{extras}</div>
              <div style={{ ...LABEL, marginTop: 12, marginBottom: 2 }}>VIEW</div>
              {viewControls}
              <div style={{ marginTop: 10 }}>{costsPanel}</div>
            </div>
            <div style={{ minHeight: 0 }}>{stage}</div>
          </section>
          <aside style={{ minHeight: 0, overflowY: 'auto', borderLeft: '1px solid var(--rule)', padding: '28px 32px 40px', display: 'flex', flexDirection: 'column', gap: 28 }}>
            {impact}
            {optionsPanel}
            {help}
            {note}
          </aside>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            <div style={{ padding: '12px var(--gutter)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {viewControls}
              <div style={{ display: 'flex', gap: 8 }}>{extras}</div>
            </div>
            <div style={{ padding: '0 12px' }}>{stage}</div>
            <div style={{ padding: '24px var(--gutter) 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
              {impact}
              {optionsPanel}
              {costsPanel}
              {help}
              {note}
            </div>
          </div>
          {/* Dock: live read-out + tools + AI, always reachable */}
          <div style={{ borderTop: '1px solid var(--rule)', background: 'var(--page)', padding: '10px 12px', paddingBottom: 'max(10px, env(safe-area-inset-bottom))', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) auto', gap: 6 }}>
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', gap: 12, padding: '0 4px 2px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)' }}>
              <span>COOLING <span style={{ color: 'var(--accent)' }}>{(() => { const c = Number(sim.metrics?.temp_reduction_c ?? 0); return `${c >= 0.005 ? '−' : ''}${c.toFixed(2)}°`; })()}</span></span>
              <span style={{ color: totalCost > budget ? 'var(--warn)' : 'var(--muted)' }}>{inr(totalCost)} of {inr(budget)}</span>
            </div>
            {toolCards}
            <button onClick={() => setShowAi(true)} title="Ask AI to plan"
              style={{ width: 52, borderRadius: 14, background: 'var(--accent)', color: 'var(--on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={20} />
            </button>
          </div>
        </>
      )}

      <AnimatePresence>
        {whyKey && <MetricWhyModal metricKey={whyKey} metrics={sim.metrics} breakdown={sim.breakdown} onClose={() => setWhyKey(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showAi && (
          <AiSheet
            block={block} years={years} budget={budget} unitCost={userPrices} onBudget={setBudget}
            onApply={(pls) => {
              // keep the user's own plan so it can be compared with the AI's
              if (items.length && !options.some((o) => o.items === items)) saveOption(sim.metrics, 'Your plan');
              setItems(fromCellPlacements(pls, grid.cellM)); setShowAi(false); toast('AI plan applied · your plan saved to compare');
            }}
            onClose={() => setShowAi(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showCompare && (
          <Dialog onClose={() => setShowCompare(false)}>
            <CompareTable options={options} current={items.length && !options.some((o) => o.items === items) ? { label: 'Current', years, metrics: sim.metrics } : null} />
          </Dialog>
        )}
      </AnimatePresence>
    </div>
  );
}
