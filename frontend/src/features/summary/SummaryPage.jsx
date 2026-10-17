import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Package, MapPin, Edit3, Copy, Printer, Check, FileText } from 'lucide-react';
import { endpoints } from '../../api/endpoints.js';
import { useBlock } from '../../api/useBlock.js';
import { useSession } from '../../state/session.js';
import { toCellPlacements } from '../../model/placements.js';
import PlanCompare from './PlanCompare.jsx';
import { MetricWhyModal } from '../../shared/metrics/MetricWhyModal.jsx';
import { Dialog, Reveal, Pill, Spinner, ThemeToggle, useToast } from '../../shared/ui';
import AppBar from '../../shared/layout/AppBar.jsx';
import { Card } from '../../shared/layout/Card.jsx';
import { useWide } from '../../shared/layout/useWide.js';
import { inr, displayCurrency } from '../../shared/lib/format.js';
import { flattenGrid } from '../../shared/heatmap/draw.js';


export default function SummaryPage() {
  const navigate = useNavigate();
  const toast = useToast();

  // The plan lives in the session store (it survives a refresh); the numbers shown here are the SERVER's canonical
  // simulation of that plan, not the browser's live estimate.
  const blockId = useSession((st) => st.blockId);
  const items = useSession((st) => st.items);
  const years = useSession((st) => st.years);
  const storedPlan = useSession((st) => st.plan);
  const budget = useSession((st) => st.budget);
  const userPrices = useSession((st) => st.unitCost);
  const [whyKey, setWhyKey] = useState(null);
  const [showProposal, setShowProposal] = useState(false);
  const { block } = useBlock(blockId);
  const placements = useMemo(() => toCellPlacements(items), [items]);

  const [canon, setCanon]       = useState(null);
  const [planName, setPlanName] = useState('Plan A');
  const [planId, setPlanId]     = useState(storedPlan?.id ?? null);
  const [bom, setBom]           = useState(storedPlan?.bom ?? null);
  const [saving, setSaving]     = useState(false);
  const [writing, setWriting]   = useState(false);
  const [proposal, setProposal] = useState(null);
  const [propSource, setPropSource] = useState(null);
  const [error, setError]       = useState(null);
  const { metrics, breakdown, cooling } = canon ?? {};

  useEffect(() => {
    if (!block || !placements.length) return undefined;
    let alive = true;
    endpoints.simulate(block.id, placements, years, userPrices)
      .then((r) => alive && setCanon({ metrics: r.metrics, breakdown: r.breakdown, cooling: flattenGrid(r.cooling_grid) }))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [block, placements, years, userPrices]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await endpoints.createPlan({
        block_id: block.id,
        placements: placements.map(p => ({ type: p.type, row: p.row, col: p.col, count: p.count })),
        years,
        unit_cost: userPrices ?? undefined,   // the saved plan keeps the prices it was costed with
        name: planName.trim() || 'Untitled plan',
      });
      const id = res.id;
      const bomData = await endpoints.planBom(id);
      setPlanId(id);
      setBom(bomData);
      useSession.getState().setPlan({ id, bom: bomData });
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
      const res = await endpoints.planProposal(planId, displayCurrency().code);
      setProposal(res.text);
      setPropSource(res.source);
      setShowProposal(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setWriting(false);
    }
  }

  const wide = useWide();
  const noPlan = !blockId || !placements.length;
  const blockName = block?.name.replace(' (synthetic demo)', '') ?? '';
  const barActions = <ThemeToggle />;

  if (noPlan) return (
    <div style={{ minHeight: '100dvh' }}>
      <AppBar step={1} actions={<ThemeToggle />} />
      <div style={{ maxWidth: 560, margin: '14vh auto 0', padding: '0 var(--gutter)', textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em' }}>No plan to review yet</h1>
        <p style={{ marginTop: 10, color: 'var(--ink-soft)' }}>Place a few trees, roofs or bus stops in the Studio first.</p>
        <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center' }}>
          <Pill label={blockId ? 'Back to the Studio' : 'Find your place'} onClick={() => navigate(blockId ? `/${blockId.startsWith('a_') ? 'area' : 'block'}/${blockId}` : '/explore')} />
        </div>
      </div>
    </div>
  );
  if (!block) return <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>;

  const unitCost = breakdown?.unit_cost ?? {}, costParts = breakdown?.cost_parts ?? {};
  const pad = wide ? '0 40px' : '0 var(--gutter)';
  const m = metrics ?? {};
  const deg = (v, d = 2) => { const x = Math.abs(Number(v ?? 0)); return `${x >= 0.5 * 10 ** -d ? '−' : ''}${x.toFixed(d)}°`; };

  const kpis = [
    ['cooling', 'Street cooling', deg(m.temp_reduction_c), 'average'],
    ['cooling', 'Hottest spot', deg(m.peak_reduction_c, 1), 'most cooled'],
    ['co2', 'CO₂ captured', `${(Number(m.co2_captured_kg_per_year ?? 0) / 1000).toFixed(1)} t`, 'per year'],
    ['exposure', 'Still too hot', `${Math.round(Number(m.heat_exposure_pct ?? 0))}%`, 'of outdoors'],
    ['cost', 'Total cost', inr(Number(m.total_cost_inr ?? 0)), Number(m.total_cost_inr ?? 0) > budget ? `over ${inr(budget)} budget` : `of ${inr(budget)} budget`],
    ['per_degree', 'Cost per °C', m.cost_per_degree_inr == null ? '—' : inr(Number(m.cost_per_degree_inr)), 'value for money'],
  ];

  const step = (n, title, done, active, body) => (
    <li style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 14, padding: '16px 0', borderTop: n > 1 ? '1px solid var(--rule)' : 'none' }}>
      <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 12,
        background: done ? 'var(--accent)' : 'transparent', color: done ? 'var(--on-accent)' : active ? 'var(--accent)' : 'var(--muted)', border: done ? 'none' : `1px solid ${active ? 'var(--accent)' : 'var(--rule)'}` }}>
        {done ? <Check size={14} /> : n}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', color: active || done ? 'var(--ink)' : 'var(--muted)' }}>
          {title}<span className="sr-only">{done ? ' (done)' : active ? ' (next)' : ''}</span>
        </div>
        {body && <div style={{ marginTop: 10 }}>{body}</div>}
      </div>
    </li>
  );

  const bomTable = bom && (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums', fontSize: 13.5 }}>
      <tbody>
        {bom.map((it) => (
          <tr key={it.type} style={{ borderBottom: '1px solid var(--rule)' }}>
            <td style={{ padding: '8px 0' }}>{it.item.split(',')[0]}<div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{it.quantity} {it.unit}{unitCost[it.type] != null ? ` × ${inr(unitCost[it.type])}` : ''}</div></td>
            <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12.5, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{costParts[it.type] != null ? inr(costParts[it.type]) : '—'}</td>
          </tr>
        ))}
        <tr><th scope="row" style={{ textAlign: 'left', padding: '8px 0', fontWeight: 600 }}>Total</th>
          <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent)' }}>{inr(Number(m.total_cost_inr ?? 0))}</td></tr>
      </tbody>
    </table>
  );

  const nextSteps = (
    <Card kicker="NEXT STEPS" style={{ padding: wide ? '22px 24px 8px' : '20px 20px 6px' }}>
      <ol style={{ listStyle: 'none' }}>
        {step(1, planId ? `Saved as "${planName.trim() || 'Untitled plan'}"` : 'Save the plan', Boolean(planId), !planId, !planId && (
          <div style={{ display: 'flex', gap: 8 }}>
            <label htmlFor="plan-name" className="sr-only">Plan name</label>
            <input id="plan-name" value={planName} onChange={(e) => setPlanName(e.target.value)} maxLength={80} placeholder="Plan name"
              style={{ flex: 1, minWidth: 0, height: 42, padding: '0 14px', background: 'var(--sunk)', border: '1px solid var(--rule)', borderRadius: 12, fontSize: 14.5, fontWeight: 550, color: 'var(--ink)' }} />
            <Pill label="Save" icon={Package} dense height={42} loading={saving} onClick={save} />
          </div>
        ))}
        {step(2, 'Bill of materials', Boolean(planId), false, planId ? bomTable : <span style={{ fontSize: 13, color: 'var(--muted)' }}>Quantities and costs appear when you save.</span>)}
        {step(3, 'Funding proposal', Boolean(proposal), Boolean(planId) && !proposal, planId && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {proposal && <Pill label="Open proposal" icon={FileText} dense onClick={() => setShowProposal(true)} />}
            <Pill label={proposal ? 'Rewrite' : 'Write the proposal'} icon={Edit3} kind={proposal ? 'outline' : 'solid'} dense loading={writing} onClick={writeProposal} />
          </div>
        ))}
        {step(4, 'Find vendors', false, Boolean(planId), planId && <Pill label="Find vendors near the area" icon={MapPin} kind="outline" dense onClick={() => navigate('/vendors')} />)}
      </ol>
    </Card>
  );

  return (
    <div style={{ minHeight: '100dvh' }}>
      <AppBar step={1} title={blockName} actions={barActions} />
      <main style={{ maxWidth: 1320, margin: '0 auto', padding: pad }}>
        <div style={{ padding: wide ? '24px 0 18px' : '20px 0 14px' }}>
          <h1 style={{ fontSize: wide ? 34 : 30, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.1 }}>
            Before &amp; <em style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, color: 'var(--accent)' }}>after</em>
          </h1>
          <p style={{ marginTop: 6, fontSize: 14.5, color: 'var(--ink-soft)' }}>{blockName} · year {years} · measured heat today against the same place with your plan. Cooling figures are estimates.</p>
        </div>

        {/* map column sized from the map (as tall as the screen allows), the panel takes the rest: no dead gap between them */}
        <div style={{ display: 'grid', gridTemplateColumns: wide ? `minmax(0, calc((100dvh - 330px) * ${block.cols / block.rows})) minmax(380px, 1fr)` : '1fr', gap: wide ? 36 : 24, alignItems: 'start' }}>
          <Reveal delay={0.1}><PlanCompare block={block} placements={placements} cooling={cooling} years={years} maxMapHeight={wide ? 'calc(100dvh - 330px)' : '70dvh'} /></Reveal>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section aria-label="Results" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, background: 'var(--rule)', border: '1px solid var(--rule)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              {kpis.map(([key, label, value, sub], i) => (
                <button key={label} onClick={() => setWhyKey(key)} title={`How is ${label.toLowerCase()} calculated?`}
                  style={{ background: 'var(--surface)', padding: '14px 14px 12px', textAlign: 'left', minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.03em', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label.toUpperCase()}</div>
                  <div style={{ marginTop: 6, fontSize: i < 2 ? 22 : 18, fontWeight: 600, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', color: i === 0 && Number(m.temp_reduction_c) > 0.005 ? 'var(--accent)' : key === 'cost' && Number(m.total_cost_inr ?? 0) > budget ? 'var(--warn)' : 'var(--ink)', whiteSpace: 'nowrap' }}>
                    {metrics ? value : '…'}
                  </div>
                  <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
                </button>
              ))}
            </section>
            {nextSteps}
            {error && <p role="alert" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--warn)' }}>{error}</p>}
          </div>
        </div>
        <div style={{ height: 48 }} />
      </main>

      <AnimatePresence>
        {whyKey && <MetricWhyModal metricKey={whyKey} metrics={metrics} breakdown={breakdown} onClose={() => setWhyKey(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showProposal && proposal && (
          <Dialog onClose={() => setShowProposal(false)} width={860}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, paddingRight: 44 }}>
              <Pill label="Copy text" icon={Copy} kind="outline" dense onClick={() => { navigator.clipboard.writeText(proposal); toast('Proposal copied'); }} />
              <Pill label="Print / PDF" icon={Printer} kind="outline" dense onClick={() => window.print()} />
            </div>
            <ProposalDocument text={proposal} gemini={propSource === 'gemini'} />
          </Dialog>
        )}
      </AnimatePresence>
    </div>
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
    <article style={{ background: 'var(--paper)', borderRadius: 18, padding: '22px 30px 30px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: _soft, marginBottom: 8 }}>{gemini ? 'DRAFTED BY GEMINI · NUMBERS CHECKED' : 'TEMPLATE DRAFT'}</div>
      {blocks}
    </article>
  );
}
