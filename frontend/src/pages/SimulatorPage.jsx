import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, RotateCcw, Undo2, ArrowRight, Sparkles, Trees, House, Bus } from 'lucide-react';
import { api } from '../api/client.js';
import { inr } from '../utils/format.js';
import HeatGrid from '../components/HeatGrid.jsx';
import { parseBlock } from '../utils/heatGrid.js';
import { MetricsBoard, MetricWhyModal, BottomSheet } from '../components/MetricsBoard.jsx';
import { Reveal, Kicker, Pill, PillToggle, CircleBtn, Glass, Spinner, useToast } from '../components/UI.jsx';
import AiSheet from './AiSheet.jsx';

const MAX_TREES = 10;
const TOOLS = [
  { value: 'tree',       label: 'Tree',  icon: Trees },
  { value: 'cool_roof',  label: 'Roof',  icon: House },
  { value: 'shade_stop', label: 'Shade', icon: Bus },
];

const VIEW_OPTS  = [{ value: false, label: 'Today' }, { value: true, label: 'With plan' }];
const YEAR_OPTS  = [{ value: 1, label: 'Yr 1' }, { value: 10, label: 'Yr 10' }, { value: 20, label: 'Yr 20' }];

export default function SimulatorPage() {
  const { id } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const [block, setBlock] = useState(state?.block ? parseBlock(state.block) : null);
  const [loading, setLoading] = useState(!state?.block);

  // Sim state
  const [placements, setPlacements] = useState([]);
  const [history, setHistory]       = useState([]);
  const [tool, setTool]             = useState('tree');
  const [showAfter, setShowAfter]   = useState(true);
  const [years, setYears]           = useState(10);
  const [budget, setBudget]         = useState(2_000_000);

  // Result state
  const [metrics, setMetrics]     = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [cooling, setCooling]     = useState(null);
  const [simError, setSimError]   = useState(null);

  const [whyKey, setWhyKey]     = useState(null);
  const [showAi, setShowAi]     = useState(false);
  const [wide, setWide]         = useState(window.innerWidth >= 900);

  const debounceRef = useRef();
  const seqRef      = useRef(0);
  const [simBusy, setSimBusy] = useState(false);

  useEffect(() => {
    const handler = () => setWide(window.innerWidth >= 900);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Load block if not passed via router state
  useEffect(() => {
    if (!state?.block) {
      api.get(`/blocks/${id}`).then(b => setBlock(parseBlock(b))).catch(e => toast(e.message));
    }
  }, [id]);

  // Debounced simulate call
  useEffect(() => {
    if (!block) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => simulate(), 120);
    return () => clearTimeout(debounceRef.current);
  }, [placements, years, block]);

  async function simulate() {
    if (!block) return;
    const seq = ++seqRef.current;
    setSimBusy(true);
    try {
      const res = await api.post('/simulate', {
        block_id: block.id,
        placements: placements.map(p => ({ type: p.type, row: p.row, col: p.col, count: p.count })),
        years,
      });
      if (seq !== seqRef.current) return;
      setMetrics(res.metrics);
      setBreakdown(res.breakdown);
      setCooling(res.cooling_grid);
      setSimError(null);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setSimError(e.message);
    } finally {
      if (seq === seqRef.current) setSimBusy(false);
    }
  }

  function whyNot(type, row, col) {
    if (!block) return null;
    const cls = block.landcover_classes;
    const lc  = block.landcover[row][col];
    const bf  = block.building_frac[row][col];
    const ra  = block.roof_area_m2[row][col];
    if (type === 'tree'       && (bf >= 0.5 || cls[lc] === 'water')) return 'No room for a tree here';
    if (type === 'cool_roof'  && ra <= 0)                              return 'No roof in this cell';
    if (type === 'shade_stop' && cls[lc] !== 'road')                   return 'Bus stops go on roads';
    return null;
  }

  function handleTap(row, col) {
    const why = whyNot(tool, row, col);
    if (why) { toast(why); return false; }

    const idx = placements.findIndex(p => p.row === row && p.col === col && p.type === tool);
    if (idx >= 0 && tool !== 'tree') { toast(`${TOOLS.find(t => t.value === tool)?.label} already here`); return false; }
    if (idx >= 0 && placements[idx].count >= MAX_TREES) { toast(`Cell is full (${MAX_TREES} trees)`); return false; }

    const next = [...placements];
    if (idx >= 0) {
      next[idx] = { ...next[idx], count: next[idx].count + 1 };
    } else {
      next.push({ type: tool, row, col, count: 1 });
    }
    setHistory(h => [...h.slice(-199), placements]);
    setPlacements(next);
  }

  function handleLongPress(row, col) {
    const next = placements.filter(p => !(p.row === row && p.col === col));
    if (next.length < placements.length) {
      setHistory(h => [...h.slice(-199), placements]);
      setPlacements(next);
      toast('Removed');
    }
  }

  function undo() {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setPlacements(prev);
  }

  function startOver() {
    const n = placements.reduce((a, p) => a + p.count, 0);
    const saved = [...placements];
    setHistory(h => [...h.slice(-199), placements]);
    setPlacements([]);
    toast(`Cleared ${n} items`);
  }

  function applyPlan(newPlacements) {
    setHistory(h => [...h.slice(-199), placements]);
    setPlacements(newPlacements);
  }

  const totalItems  = placements.reduce((a, p) => a + p.count, 0);
  const totalCost   = Number(metrics?.total_cost_inr ?? 0);
  const budgetPct   = budget === 0 ? 0 : Math.min(1, totalCost / budget);
  const overBudget  = totalCost > budget;

  if (loading || !block) {
    return <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>;
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  const blockName = block.name.replace(' (synthetic demo)', '');

  const topBar = (
    <div style={{ display: 'flex', alignItems: wide ? 'center' : 'flex-start', gap: 8, flexDirection: wide ? 'row' : 'column' }}>
      {!wide && (
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <CircleBtn icon={ArrowLeft} tooltip="Back" onClick={() => navigate('/')} />
          <div style={{ flex: 1 }} />
          <ActionBtns canUndo={history.length > 0} onUndo={undo} onStartOver={totalItems > 0 ? startOver : null} onSummary={totalItems > 0 ? () => navigate('/summary', { state: { block, placements, metrics, breakdown, cooling, years, budget } }) : null} />
        </div>
      )}
      {wide && <CircleBtn icon={ArrowLeft} tooltip="Back" onClick={() => navigate('/')} />}
      {wide && <div style={{ width: 14 }} />}
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: wide ? 28 : 34, lineHeight: 1, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
          {blockName}
        </div>
        <div style={{ height: 4 }} />
        <div style={{ height: 26, display: 'flex', alignItems: 'center' }}>
          {totalItems === 0
            ? <span style={{ fontFamily: 'var(--font-hand)', fontSize: 21, color: 'var(--accent)', lineHeight: 1.05 }}>tap a street on the map to plant a tree</span>
            : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted)' }}>{totalItems} ITEMS · YEAR {years}{block.synthetic ? ' · DEMO DATA' : ''}</span>
          }
        </div>
      </div>
      {wide && <ActionBtns canUndo={history.length > 0} onUndo={undo} onStartOver={totalItems > 0 ? startOver : null} onSummary={totalItems > 0 ? () => navigate('/summary', { state: { block, placements, metrics, breakdown, cooling, years, budget } }) : null} />}
    </div>
  );

  const controls = (
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ flex: 1 }}>
        <PillToggle options={VIEW_OPTS} value={showAfter} onChange={setShowAfter} dense expand />
      </div>
      <div style={{ flex: 1 }}>
        <PillToggle options={YEAR_OPTS} value={years} onChange={setYears} dense expand />
      </div>
    </div>
  );

  const metricsPanel = (
    <MetricsBoard
      metrics={metrics}
      breakdown={breakdown}
      heroSize={wide ? 34 : 28}
      stacked={wide}
      onInfo={setWhyKey}
    />
  );

  const budgetBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>BUDGET</span>
      <div style={{ flex: 1, height: 4, background: 'var(--rule)', borderRadius: 2, overflow: 'hidden' }}>
        <motion.div
          animate={{ width: `${budgetPct * 100}%` }}
          transition={{ duration: 0.65, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ height: '100%', background: overBudget ? 'var(--warn)' : 'var(--accent)', borderRadius: 2 }}
        />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: overBudget ? 'var(--warn)' : 'var(--ink)', whiteSpace: 'nowrap', minWidth: 118, textAlign: 'right' }}>
        {inr(totalCost)} / {inr(budget)}
      </span>
    </div>
  );

  const map = (
    <HeatGrid
      block={block}
      placements={placements}
      cooling={cooling}
      showAfter={showAfter}
      onTap={handleTap}
      onLongPress={handleLongPress}
    />
  );

  const dock = (
    <div style={{ padding: '12px 12px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <Glass radius={30} padding="6px">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <PillToggle
                options={TOOLS.map(t => ({ value: t.value, label: t.label, icon: t.icon }))}
                value={tool}
                onChange={setTool}
                bare
                expand
              />
            </div>
            <Pill label="Ask AI" icon={Sparkles} height={44} onClick={() => setShowAi(true)} />
          </div>
        </Glass>
      </div>
    </div>
  );

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {wide ? (
        /* Wide layout: map left, sidebar right */
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px var(--gutter) 14px' }}>{topBar}</div>
            <div style={{ padding: '0 var(--gutter) 12px' }}>{controls}</div>
            <div style={{ flex: 1, padding: '0 var(--gutter)', overflow: 'hidden' }}>{map}</div>
            {dock}
          </div>
          <div style={{ width: 380, borderLeft: '1px solid var(--rule)', overflowY: 'auto', padding: 24 }}>
            {simBusy && <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}><Spinner size={14} /><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Simulating…</span></div>}
            <Kicker>Live estimate</Kicker>
            <div style={{ height: 18 }} />
            {metricsPanel}
            <div style={{ height: 28 }} />
            {budgetBar}
            <div style={{ height: 28 }} />
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
              Tap a cell to place · long-press to remove · scroll to zoom. Tap any number to see how it is calculated.
            </p>
            {simError && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--warn)', marginTop: 12 }}>{simError}</p>}
          </div>
        </div>
      ) : (
        /* Narrow layout: stacked */
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <div style={{ padding: '8px var(--gutter) 16px' }}>{topBar}</div>
          <div style={{ padding: '0 var(--gutter)' }}>
            {simBusy && <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}><Spinner size={12} /><span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>Simulating…</span></div>}
            {metricsPanel}
          </div>
          <div style={{ padding: '14px var(--gutter)' }}>{budgetBar}</div>
          <div style={{ padding: '0 var(--gutter) 10px' }}>{controls}</div>
          <div style={{ padding: '0 12px' }}>{map}</div>
          {simError && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--warn)', padding: '8px var(--gutter)' }}>{simError}</p>}
        </div>
      )}

      {!wide && dock}

      {/* Metric why sheet */}
      <AnimatePresence>
        {whyKey && <MetricWhyModal metricKey={whyKey} metrics={metrics} breakdown={breakdown} onClose={() => setWhyKey(null)} />}
      </AnimatePresence>

      {/* AI sheet */}
      <AnimatePresence>
        {showAi && (
          <AiSheet
            block={block}
            years={years}
            budget={budget}
            onBudget={setBudget}
            onApply={(pls) => { applyPlan(pls); setShowAi(false); }}
            onClose={() => setShowAi(false)}
          />
        )}
      </AnimatePresence>
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
