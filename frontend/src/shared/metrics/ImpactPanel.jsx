import { motion } from 'framer-motion';
import { AnimatedNumber, InfoLabel, LABEL, Spinner } from '../ui';
import { inr } from '../lib/format.js';

const n = (src, k) => Number(src?.[k] ?? 0);

// Simulator read-out in three tiers: headline cooling, two supporting heroes,
// then small print (secondary stats, budget, plan, landmarks).
const NUM = { fontFamily: 'var(--font-sans)', fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums' };
const deg = (v, d = 2) => `${Math.abs(v) >= 0.5 * 10 ** -d ? '−' : ''}${Math.abs(v).toFixed(d)}°`;

export function ImpactPanel({ metrics: m, breakdown: b, budget, years, busy, error, compact = false, onInfo, kicker = 'LIVE ESTIMATE' }) {
  const cool = n(m, 'temp_reduction_c'), peak = n(m, 'peak_reduction_c');
  const aqi = n(m, 'aqi_change'), co2 = n(m, 'co2_captured_kg_per_year');
  const cost = n(m, 'total_cost_inr');
  const over = cost > budget;
  const parts = b?.cost_parts ?? {};
  const landmarks = Object.entries(m?.landmark_cooling_c ?? {}).sort((x, y) => y[1] - x[1]);

  const tap = (key) => ({ onClick: () => onInfo?.(key), style: { cursor: 'pointer', minWidth: 0 } });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 20 : 28 }}>
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...LABEL }}>
          {busy ? <Spinner size={10} /> : <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)' }} />}
          {kicker} · YEAR {years}
        </div>
      )}

      {/* The numbers below are only true when the plan could be simulated: say so loudly, never show zeros as if real */}
      {error && (
        <div role="alert" style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--warn)', color: 'var(--warn)', fontSize: 13, lineHeight: 1.45 }}>
          <b>Can't estimate this plan.</b> {error}. Undo or erase that item; the numbers below are not up to date.
        </div>
      )}

      {/* Tier 1: the number the plan is judged on */}
      <div {...tap('cooling')}>
        <InfoLabel label="STREET COOLING" onInfo={() => onInfo?.('cooling')} />
        <AnimatedNumber value={cool} format={v => deg(v)}
          style={{ ...NUM, display: 'block', marginTop: 10, fontSize: compact ? 48 : 68, letterSpacing: '-0.05em', color: cool > 0.005 ? 'var(--accent)' : 'var(--ink)' }} />
        <div style={{ marginTop: 10, fontSize: 13.5, color: 'var(--ink-soft)' }}>
          Average over streets and open ground · hottest spot <span style={{ color: peak > 0.05 ? 'var(--cool)' : 'var(--ink-soft)', fontFamily: 'var(--font-mono)' }}>{deg(peak, 1)}</span>
        </div>
      </div>

      {/* Tier 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div {...tap('aqi')}>
          <InfoLabel label="AIR QUALITY" onInfo={() => onInfo?.('aqi')} />
          <AnimatedNumber value={aqi} format={v => b?.baseline_aqi == null ? '—' : Math.abs(v) < 0.005 ? '0.00' : `−${Math.abs(v).toFixed(2)}`}
            style={{ ...NUM, display: 'block', marginTop: 8, fontSize: compact ? 26 : 32, letterSpacing: '-0.04em', color: aqi < -0.005 ? 'var(--accent)' : 'var(--ink)' }} />
          <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--muted)' }}>{b?.baseline_aqi == null ? 'no AQI reading for this area' : 'AQI points'}</div>
        </div>
        <div {...tap('co2')}>
          <InfoLabel label="CO₂ CAPTURED" onInfo={() => onInfo?.('co2')} />
          <AnimatedNumber value={co2} format={v => `${(v / 1000).toFixed(1)} t`}
            style={{ ...NUM, display: 'block', marginTop: 8, fontSize: compact ? 26 : 32, letterSpacing: '-0.04em' }} />
          <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--muted)' }}>per year</div>
        </div>
      </div>

      {/* Tier 3: small print */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, paddingTop: 20, borderTop: '1px solid var(--rule)' }}>
        {[
          ['exposure', 'STILL TOO HOT', `${Math.round(n(m, 'heat_exposure_pct'))}% of outdoors`],
          ['air', 'AIR COOLING', `${deg(n(m, 'air_reduction_c'))} at head height`],
          ['equity', 'FOR VULNERABLE RESIDENTS', m?.equity_cooling_c == null ? 'no population data' : `${deg(n(m, 'equity_cooling_c'))} in the most exposed areas`],
          ['per_degree', 'COST PER °C', m?.cost_per_degree_inr == null ? '—' : inr(n(m, 'cost_per_degree_inr'))],
        ].map(([key, label, val]) => (
          <div key={key} {...tap(key)}>
            <InfoLabel label={label} onInfo={() => onInfo?.(key)} />
            <div style={{ ...NUM, marginTop: 6, fontSize: 16, letterSpacing: '-0.02em' }}>{val}</div>
          </div>
        ))}
      </div>

      <div {...tap('cost')}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={LABEL}>BUDGET</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: over ? 'var(--warn)' : 'var(--ink)' }}>
            {inr(cost)} <span style={{ color: 'var(--muted)' }}>of {inr(budget)}</span>
          </span>
        </div>
        <div style={{ height: 6, background: 'var(--rule)', borderRadius: 3, overflow: 'hidden' }}>
          <motion.div animate={{ width: `${Math.min(1, budget ? cost / budget : 0) * 100}%` }} transition={{ duration: 0.65, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ height: '100%', background: over ? 'var(--warn)' : 'var(--accent)', borderRadius: 3 }} />
        </div>
        {over
          ? <div style={{ marginTop: 6, fontSize: 12, color: 'var(--warn)' }}>Over budget by {inr(cost - budget)}</div>
          : <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)' }}>
              <span>{budget ? Math.round((cost / budget) * 100) : 0}% used</span>
              <span style={{ color: 'var(--ink)' }}>{inr(budget - cost)} left</span>
            </div>}
      </div>

      <SmallTable title="YOUR PLAN" rows={[
        ['Trees', `${Math.round(n(b, 'trees'))}`, inr(parts.tree ?? 0)],
        ['Cool roofs', `${Math.round(n(b, 'roof_m2'))} m²`, inr(parts.cool_roof ?? 0)],
        ['Shaded bus stops', `${Math.round(n(b, 'stops'))}`, inr(parts.shade_stop ?? 0)],
      ]} />

      {landmarks.length > 0 && (
        <SmallTable title="COOLING AT LANDMARKS" rows={landmarks.map(([name, c]) => [name, '', deg(c)])} />
      )}
    </div>
  );
}

function SmallTable({ title, rows }) {
  return (
    <div>
      <div style={{ ...LABEL, marginBottom: 4 }}>{title}</div>
      {rows.map(([k, mid, v]) => {
        const zero = v === '₹0' || /^0\.0+°$/.test(v);
        return (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr auto 76px', gap: 12, alignItems: 'baseline', padding: '9px 0', borderBottom: '1px solid var(--rule)', fontSize: 13.5, color: zero ? 'var(--muted)' : 'var(--ink)' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>{mid}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, textAlign: 'right' }}>{v}</span>
          </div>
        );
      })}
    </div>
  );
}

