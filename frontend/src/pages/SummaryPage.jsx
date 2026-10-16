import { useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Package, MapPin, Edit3, Copy } from 'lucide-react';
import { api } from '../api/client.js';
import { inr } from '../utils/format.js';
import HeatGrid from '../components/HeatGrid.jsx';
import { MetricsBoard } from '../components/MetricsBoard.jsx';
import { Reveal, SectionHead, CircleBtn, Kicker, Pill } from '../components/UI.jsx';
import { HEAT_STOPS, parseBlock } from '../utils/heatGrid.js';

const HEAT_CSS = `linear-gradient(to right, ${HEAT_STOPS.map(([r,g,b]) => `rgb(${r},${g},${b})`).join(',')})`;

export default function SummaryPage() {
  const { state } = useLocation();
  const navigate  = useNavigate();

  const block = parseBlock(state?.block);
  const { placements = [], metrics, breakdown, cooling, years = 10, budget = 2_000_000 } = state ?? {};

  const [planName, setPlanName] = useState('Plan A');
  const [planId, setPlanId]     = useState(null);
  const [bom, setBom]           = useState(null);
  const [saving, setSaving]     = useState(false);
  const [writing, setWriting]   = useState(false);
  const [proposal, setProposal] = useState(null);
  const [propSource, setPropSource] = useState(null);
  const [error, setError]       = useState(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await api.post('/plans', {
        block_id: block.id,
        placements: placements.map(p => ({ type: p.type, row: p.row, col: p.col, count: p.count })),
        years,
        name: planName.trim() || 'Untitled plan',
      });
      const id = res.id;
      const bomData = await api.get(`/plans/${id}/bom`);
      setPlanId(id);
      setBom(bomData);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function writeProposal() {
    if (!planId) return;
    setWriting(true);
    setError(null);
    try {
      const res = await api.post(`/plans/${planId}/proposal`, {});
      setProposal(res.text);
      setPropSource(res.source);
    } catch (e) {
      setError(e.message);
    } finally {
      setWriting(false);
    }
  }

  if (!block) return (
    <div style={{ padding: 40, fontFamily: 'var(--font-mono)', color: 'var(--warn)' }}>
      No plan data. <button onClick={() => navigate('/')} style={{ color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit' }}>Go home</button>
    </div>
  );

  const blockName = block.name.replace(' (synthetic demo)', '');

  return (
    <div style={{ minHeight: '100dvh' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '10px var(--gutter) 48px' }}>
        <CircleBtn icon={ArrowLeft} tooltip="Back" onClick={() => navigate(-1)} />
        <div style={{ height: 28 }} />

        <SectionHead
          kicker="03 — The plan"
          title="Before & after."
          accent="after"
          sub={`${blockName} · year ${years} · drag the handle to compare. All figures are estimates.`}
          size={40}
        />

        <div style={{ height: 24 }} />

        {/* Compare slider */}
        <Reveal delay={0.2}>
          <div style={{ borderRadius: 'var(--radius)', border: '1px solid var(--rule)', overflow: 'hidden' }}>
            <CompareSlider
              before={<HeatGrid block={block} placements={placements} cooling={cooling} showAfter={false} readOnly />}
              after={<HeatGrid block={block} placements={placements} cooling={cooling} showAfter readOnly />}
            />
          </div>
        </Reveal>

        {/* Heat legend */}
        <div style={{ height: 12 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)' }}>{Math.round(block.minT)}°</span>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: HEAT_CSS }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)' }}>{Math.round(block.maxT)}° surface</span>
        </div>

        <div style={{ height: 32 }} />
        <MetricsBoard metrics={metrics} breakdown={breakdown} heroSize={34} />
        <div style={{ height: 44 }} />

        {/* Save / BOM section */}
        <AnimatePresence mode="wait">
          {!planId ? (
            <motion.div key="form" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <Kicker>04 — Save it</Kicker>
              <div style={{ height: 14 }} />
              <input
                value={planName}
                onChange={e => setPlanName(e.target.value)}
                maxLength={80}
                placeholder="Plan name"
                style={{
                  width: '100%', padding: '16px 18px',
                  background: 'var(--sunk)', border: '1px solid var(--rule)', borderRadius: 18,
                  fontFamily: 'var(--font-sans)', fontSize: 17, fontWeight: 550, color: 'var(--ink)',
                  outline: 'none', marginBottom: 6,
                }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--rule)'}
              />
              <div style={{ height: 6 }} />
              <Pill label="Save & build the bill of materials" icon={Package} expand loading={saving} onClick={save} />
            </motion.div>
          ) : (
            <motion.div key="saved" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Kicker>04 — Bill of materials</Kicker>
                <div style={{ flex: 1 }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>PLAN {planId}</span>
              </div>
              <div style={{ height: 8 }} />
              {bom?.map((item, i) => (
                <Reveal key={i} delay={i * 0.08}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--rule)' }}>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 15.5, fontWeight: 500 }}>{item.item}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink)' }}>{item.quantity} {item.unit}</span>
                  </div>
                </Reveal>
              ))}
              <div style={{ height: 20 }} />
              <Pill
                label="Find vendors near the block"
                icon={MapPin}
                expand
                kind="outline"
                onClick={() => navigate('/vendors', { state: { block, planId, bom } })}
              />
              <div style={{ height: 40 }} />
              <Kicker>05 — Funding proposal</Kicker>
              <div style={{ height: 10 }} />
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
                A one-page pitch for your ward office or a CSR sponsor, written from the numbers above.
              </p>
              <div style={{ height: 16 }} />
              <Pill
                label={proposal ? 'Rewrite it' : 'Write the proposal'}
                icon={Edit3}
                kind="outline"
                expand
                loading={writing}
                onClick={writeProposal}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {error && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--warn)', marginTop: 14 }}>{error}</p>}

        {/* Proposal document */}
        {proposal && (
          <div style={{ marginTop: 24 }}>
            <ProposalDocument text={proposal} gemini={propSource === 'gemini'} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── CompareSlider ──────────────────────────────────────────────────────────────
function CompareSlider({ before, after, beforeLabel = 'TODAY', afterLabel = 'WITH PLAN' }) {
  const [pos, setPos] = useState(0.5);
  const ref = useRef();

  function handleMove(clientX) {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  }

  return (
    <div
      ref={ref}
      style={{ position: 'relative', userSelect: 'none', cursor: 'col-resize', overflow: 'hidden' }}
      onMouseMove={e => e.buttons && handleMove(e.clientX)}
      onMouseDown={e => handleMove(e.clientX)}
      onTouchMove={e => handleMove(e.touches[0].clientX)}
    >
      {before}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', clipPath: `inset(0 0 0 ${pos * 100}%)` }}>
        {after}
      </div>
      {/* Divider line */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pos * 100}%`, width: 2, background: 'var(--ink)', transform: 'translateX(-1px)', pointerEvents: 'none' }} />
      {/* Handle */}
      <div style={{
        position: 'absolute', top: '50%', left: `${pos * 100}%`,
        transform: 'translate(-50%, -50%)',
        width: 40, height: 40, borderRadius: '50%',
        background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)', pointerEvents: 'none',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--page)" strokeWidth="2" strokeLinecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
      </div>
      {/* Labels */}
      <div style={{ position: 'absolute', top: 10, left: 10 }}><GlassTag label={beforeLabel} /></div>
      <div style={{ position: 'absolute', top: 10, right: 10 }}><GlassTag label={afterLabel} accent /></div>
    </div>
  );
}

function GlassTag({ label, accent = false }) {
  return (
    <div style={{
      backdropFilter: 'blur(14px)', background: 'rgba(20,24,21,0.72)',
      border: '1px solid var(--rule)', borderRadius: 999,
      padding: '5px 10px',
      fontFamily: 'var(--font-mono)', fontSize: 10.5,
      color: accent ? 'var(--accent)' : 'var(--ink)',
    }}>{label}</div>
  );
}

// ── ProposalDocument ───────────────────────────────────────────────────────────
function ProposalDocument({ text, gemini }) {
  const _ink  = '#1C211D';
  const _soft = '#4C544B';

  const blocks = text.split('\n').map((raw, i) => {
    const l = raw.trimEnd().replace(/\*\*/g, '');
    if (l.trim() === '') return <div key={i} style={{ height: 8 }} />;
    if (l.startsWith('# '))  return <h1  key={i} style={{ fontFamily: 'var(--font-serif)', fontSize: 32, color: _ink, lineHeight: 1.05, marginBottom: 6 }}>{l.slice(2)}</h1>;
    if (l.startsWith('## ')) return <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#3F7A1E', fontWeight: 600, textTransform: 'uppercase', marginTop: 12, marginBottom: 4 }}>{l.slice(3)}</div>;
    if (/^\s*([-•*]|\d+\.)\s/.test(l)) {
      const marker = /^\s*([-•*]|\d+\.)/.exec(l)?.[1] ?? '—';
      const content = l.replace(/^\s*([-•*]|\d+\.)\s+/, '');
      return (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <span style={{ width: 22, fontFamily: 'var(--font-mono)', fontSize: 12.5, color: _soft, flexShrink: 0 }}>{/\d/.test(marker) ? marker : '—'}</span>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14.5, color: _ink, lineHeight: 1.5 }}>{content}</span>
        </div>
      );
    }
    return <p key={i} style={{ fontFamily: 'var(--font-sans)', fontSize: 14.5, color: _ink, lineHeight: 1.55, marginBottom: 4 }}>{l}</p>;
  });

  return (
    <Reveal>
      <div style={{ background: 'var(--paper)', borderRadius: 20, padding: '18px 24px 28px', boxShadow: '0 30px 60px -24px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: _soft }}>{gemini ? 'DRAFTED BY GEMINI' : 'TEMPLATE DRAFT'}</span>
          <button
            onClick={() => navigator.clipboard.writeText(text)}
            title="Copy proposal"
            style={{ cursor: 'pointer', color: _ink }}
          >
            <Copy size={18} />
          </button>
        </div>
        {blocks}
      </div>
    </Reveal>
  );
}
