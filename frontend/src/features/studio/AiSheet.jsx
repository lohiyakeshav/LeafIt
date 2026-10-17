import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react';
import { endpoints } from '../../api/endpoints.js';
import { inr } from '../../shared/format.js';
import { Reveal, Kicker, SectionHead, Pill, PillToggle, Spinner, Bullets } from '../../shared/UI.jsx';
import { BottomSheet } from '../../shared/MetricsBoard.jsx';

const EXAMPLES = [
  'Keep children walking to the school cool',
  'Cool the streets where people wait for buses',
  'Best average cooling for the whole block',
];

const THINKING_LINES = [
  'Reading the block',
  'Finding the hottest streets',
  'Testing whole-block cooling',
  'Testing your priorities',
  'Comparing options',
  'Writing it up',
];

export default function AiSheet({ block, years, budget, onBudget, onApply, onClose }) {
  const [brief, setBrief]     = useState('');
  const [budgetL, setBudgetL] = useState((budget / 1e5).toFixed(0));
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [result, setResult]   = useState(null);

  const budgetVal = parseFloat(budgetL) * 1e5;
  const budgetOk  = !isNaN(budgetVal) && budgetVal >= 10_000 && budgetVal <= 1_000_000_000;

  async function run() {
    if (!budgetOk) return;
    const lakh = parseFloat(budgetL);
    onBudget?.(lakh * 1e5);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await endpoints.agentPlan({
        block_id: block.id,
        brief: brief.trim() || EXAMPLES[EXAMPLES.length - 1],
        budget_inr: lakh * 1e5,
        years,
      });
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function applyPlan() {
    if (!result) return;
    const placements = result.placements.map(p => ({ type: p.type, row: p.row, col: p.col, count: p.count ?? 1 }));
    const chosen = result.scenarios?.find(s => s.id === result.chosen);
    onApply?.(placements, chosen?.label ?? '');
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ padding: '0 4px' }}>
        <SectionHead
          kicker="02 — AI planner"
          title="What should we protect?"
          accent="protect"
          sub="Say it in your own words. Gemini tests options on the simulator and tells you why it picked one."
          size={30}
        />

        <div style={{ height: 22 }} />

        <textarea
          value={brief}
          onChange={e => setBrief(e.target.value)}
          maxLength={500}
          placeholder="e.g. Protect elderly shoppers near the market, leave roofs alone"
          style={{
            width: '100%', minHeight: 88, padding: '16px 18px',
            background: 'var(--sunk)', border: '1px solid var(--rule)',
            borderRadius: 18, resize: 'vertical',
            fontFamily: 'var(--font-sans)', fontSize: 16, color: 'var(--ink)', lineHeight: 1.45,
            outline: 'none',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--rule)'}
        />

        {/* Example chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {EXAMPLES.map((ex, i) => (
            <Reveal key={i} delay={0.25 + i * 0.07}>
              <button
                onClick={() => setBrief(ex)}
                style={{
                  padding: '8px 14px', border: '1px solid var(--rule)', borderRadius: 999,
                  background: 'transparent', cursor: 'pointer',
                  fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--ink)',
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--rule)'}
              >
                {ex}
              </button>
            </Reveal>
          ))}
        </div>

        <div style={{ height: 18 }} />

        {/* Budget field */}
        <div style={{ position: 'relative' }}>
          <label style={{ position: 'absolute', top: -8, left: 14, background: 'var(--surface)', padding: '0 4px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', zIndex: 1 }}>BUDGET</label>
          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--sunk)', border: `1px solid ${budgetOk ? 'var(--rule)' : 'var(--warn)'}`, borderRadius: 18, padding: '16px 18px', gap: 8 }}>
            <input
              type="number"
              value={budgetL}
              onChange={e => setBudgetL(e.target.value)}
              min="0.1"
              step="1"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontFamily: 'var(--font-sans)', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}
            />
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--muted)' }}>lakh ₹</span>
          </div>
          {budgetOk && (
            <div style={{ padding: '4px 4px 0', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
              = {inr(parseFloat(budgetL) * 1e5)} · from 0.1 to 10,000 lakh
            </div>
          )}
          {!budgetOk && (
            <div style={{ padding: '4px 4px 0', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--warn)' }}>
              Enter a budget between ₹10,000 and ₹100 crore
            </div>
          )}
        </div>

        <div style={{ height: 18 }} />

        <Pill
          label={loading ? 'Testing options' : 'Plan it'}
          icon={Sparkles}
          expand
          loading={loading}
          disabled={!budgetOk}
          onClick={run}
        />

        {/* Thinking animation */}
        <AnimatePresence>
          {loading && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
              <div style={{ paddingTop: 16 }}>
                <ThinkingTicker />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {error && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--warn)', marginTop: 14 }}>{error}</p>}

        {/* Result */}
        {result && <AiResult result={result} onApply={applyPlan} />}
      </div>
    </BottomSheet>
  );
}

function ThinkingTicker() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(x => (x + 1) % THINKING_LINES.length), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Spinner size={7} color="var(--accent)" />
      <AnimatePresence mode="wait">
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)' }}
        >
          {THINKING_LINES[i]}…
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function AiResult({ result, onApply }) {
  const gemini    = result.source === 'gemini';
  const unverified = result.unverified_numbers ?? [];
  const scenarios  = result.scenarios ?? [];
  const [trailOpen, setTrailOpen] = useState(false);

  return (
    <div style={{ marginTop: 28 }}>
      <hr />
      <div style={{ height: 22 }} />

      {/* Header row */}
      <Reveal>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Kicker>Recommendation</Kicker>
          <div style={{ flex: 1 }} />
          <span style={{
            padding: '5px 10px', borderRadius: 999,
            border: `1px solid ${gemini ? 'var(--accent)' : 'var(--rule)'}`,
            fontFamily: 'var(--font-mono)', fontSize: 10.5,
            color: gemini ? 'var(--accent)' : 'var(--muted)',
          }}>
            {gemini ? 'GEMINI' : 'OFFLINE RULES'}
          </span>
        </div>
      </Reveal>
      <div style={{ height: 16 }} />

      <Bullets text={result.explanation} />

      {gemini && (
        <Reveal delay={0.4}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 4 }}>
            {unverified.length === 0
              ? <CheckCircle size={15} color="var(--accent)" />
              : <AlertCircle size={15} color="var(--warn)" />
            }
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: unverified.length === 0 ? 'var(--accent)' : 'var(--warn)' }}>
              {unverified.length === 0
                ? 'Every number above was checked against the simulator'
                : `Not from the simulator, ignore: ${unverified.join(', ')}`
              }
            </span>
          </div>
        </Reveal>
      )}

      <div style={{ height: 26 }} />
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>OPTIONS TESTED</div>
      <div style={{ height: 10 }} />

      {scenarios.map((sc, i) => (
        <Reveal key={sc.id} delay={0.2 + i * 0.11}>
          <ScenarioCard sc={sc} chosen={sc.id === result.chosen} />
        </Reveal>
      ))}

      {/* Reasoning trail */}
      <div style={{ marginTop: 8 }}>
        <button
          onClick={() => setTrailOpen(o => !o)}
          style={{ width: '100%', padding: '10px 0', display: 'flex', alignItems: 'center', cursor: 'pointer', borderBottom: '1px solid var(--rule)' }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)' }}>
            REASONING TRAIL · {result.steps?.length ?? 0} STEPS
          </span>
          <div style={{ flex: 1 }} />
          <motion.div animate={{ rotate: trailOpen ? 180 : 0 }} transition={{ duration: 0.3 }}>
            <ChevronDown size={20} color="var(--ink)" />
          </motion.div>
        </button>
        <AnimatePresence>
          {trailOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
              {(result.steps ?? []).map((step, i, arr) => (
                <div key={i} style={{ display: 'flex', gap: 8, paddingBottom: 14 }}>
                  <div style={{ width: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 5 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                    {i < arr.length - 1 && <div style={{ flex: 1, width: 1, background: 'var(--rule)', marginTop: 4 }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600 }}>{step.action}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{step.detail}</div>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div style={{ height: 20 }} />
      <Pill label="Apply to the map" icon={() => <CheckCircle size={18} />} expand onClick={onApply} />
    </div>
  );
}

function ScenarioCard({ sc, chosen }) {
  const m = sc.metrics ?? {};
  return (
    <motion.div
      animate={{ borderColor: chosen ? 'var(--accent)' : 'var(--rule)', background: chosen ? 'var(--accent-soft)' : 'rgba(0,0,0,0)' }}
      style={{ borderRadius: 18, border: '1px solid var(--rule)', padding: 16, marginBottom: 10, transition: 'all 0.45s' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: chosen ? 'var(--accent)' : 'var(--muted)' }}>{sc.id}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.02em' }}>{sc.label}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            −{m.temp_reduction_c}° avg · −{m.peak_reduction_c}° peak · {inr(m.total_cost_inr)}
          </div>
        </div>
        <motion.div animate={{ scale: chosen ? 1 : 0 }} transition={{ type: 'spring', damping: 12 }}>
          <CheckCircle size={22} color="var(--accent)" />
        </motion.div>
      </div>
    </motion.div>
  );
}
