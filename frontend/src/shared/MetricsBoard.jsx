import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Reveal, AnimatedNumber, InfoLabel, Pill, Spinner } from './UI.jsx';
import { inr, formatDeg, formatAqi, formatTons } from './format.js';
import { Info, ArrowRight, X } from 'lucide-react';

function n(src, k) { return Number(src?.[k] ?? 0); }

// ── MetricsBoard ───────────────────────────────────────────────────────────────
// Mirrors widgets/metrics.dart exactly — 3 heroes + 3 minor stats
export function MetricsBoard({ metrics: m, breakdown: b, heroSize = 30, stacked = false, onInfo }) {
  const cool = n(m, 'temp_reduction_c');
  const peak = n(m, 'peak_reduction_c');
  const aqi  = n(m, 'aqi_change');
  const co2  = n(m, 'co2_captured_kg_per_year');

  const heroes = [
    {
      label: 'COOLING',
      value: cool,
      format: v => `${Math.abs(v) >= 0.005 ? '−' : ''}${Math.abs(v).toFixed(2)}°`,
      color: cool > 0.005 ? 'var(--accent)' : 'var(--ink)',
      sub: `peak ${Math.abs(peak) >= 0.05 ? '−' : ''}${Math.abs(peak).toFixed(1)}°`,
      subColor: peak > 0.05 ? 'var(--cool)' : 'var(--muted)',
      key: 'cooling',
    },
    {
      label: 'AIR QUALITY',
      value: aqi,
      format: v => Math.abs(v) < 0.005 ? '0.00' : Math.abs(v).toFixed(2),
      color: aqi < -0.005 ? 'var(--accent)' : 'var(--ink)',
      sub: 'AQI points',
      subColor: 'var(--muted)',
      key: 'aqi',
    },
    {
      label: 'CO₂',
      value: co2,
      format: v => `${(v / 1000).toFixed(1)} t`,
      color: 'var(--ink)',
      sub: 'captured / year',
      subColor: 'var(--muted)',
      key: 'co2',
    },
  ];

  const minor = [
    { label: 'HEAT-EXPOSED', value: n(m, 'heat_exposure_pct'), format: v => `${Math.round(v)}%`, key: 'exposure' },
    { label: 'COST', value: n(m, 'total_cost_inr'), format: inr, key: 'cost' },
    { label: '₹ PER °C', value: n(m, 'cost_per_degree_inr'), format: v => m?.cost_per_degree_inr == null ? '—' : inr(v), key: 'per_degree' },
  ];

  return (
    <div>
      {stacked ? (
        heroes.map((h, i) => {
          const { key, ...rest } = h;
          return (
            <Reveal key={key} delay={i * 0.06}>
              <div style={{ marginBottom: 18 }}>
                <HeroStat {...rest} size={heroSize} onInfo={() => onInfo?.(key)} />
              </div>
            </Reveal>
          );
        })
      ) : (
        <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
          {heroes.map((h, i) => {
            const { key, ...rest } = h;
            return (
              <div key={key} style={{ display: 'flex', flex: 1, alignItems: 'stretch' }}>
                {i > 0 && <div style={{ width: 1, background: 'var(--rule)', margin: '0 12px' }} />}
                <Reveal delay={i * 0.06} style={{ flex: 1 }}>
                  <HeroStat {...rest} size={heroSize} onInfo={() => onInfo?.(key)} />
                </Reveal>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ height: stacked ? 4 : 16 }} />
      <Reveal delay={0.2}>
        <div style={{ paddingTop: 12, borderTop: '1px solid var(--rule)', display: 'flex', gap: 12 }}>
          {minor.map((mn) => {
            const { key, ...rest } = mn;
            return (
              <div key={key} style={{ flex: 1 }}>
                <MinorStat {...rest} onInfo={() => onInfo?.(key)} />
              </div>
            );
          })}
        </div>
      </Reveal>
    </div>
  );
}

// ── ImpactPanel ───────────────────────────────────────────────────────────────
// Simulator read-out in three tiers: headline cooling, two supporting heroes,
// then small print (secondary stats, budget, plan, landmarks).
const LABEL = { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em', color: 'var(--muted)' };
const NUM = { fontFamily: 'var(--font-sans)', fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums' };
const deg = (v, d = 2) => `${Math.abs(v) >= 0.5 * 10 ** -d ? '−' : ''}${Math.abs(v).toFixed(d)}°`;

export function ImpactPanel({ metrics: m, breakdown: b, budget, years, busy, compact = false, onInfo, kicker = 'LIVE ESTIMATE' }) {
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
          <AnimatedNumber value={aqi} format={v => Math.abs(v) < 0.005 ? '0.00' : `−${Math.abs(v).toFixed(2)}`}
            style={{ ...NUM, display: 'block', marginTop: 8, fontSize: compact ? 26 : 32, letterSpacing: '-0.04em', color: aqi < -0.005 ? 'var(--accent)' : 'var(--ink)' }} />
          <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--muted)' }}>AQI points</div>
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
          ['per_degree', '₹ PER °C', m?.cost_per_degree_inr == null ? '—' : inr(n(m, 'cost_per_degree_inr'))],
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
        {over && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--warn)' }}>Over budget by {inr(cost - budget)}</div>}
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

function HeroStat({ label, value, format, color, sub, subColor, size, onInfo }) {
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      onClick={onInfo}
      style={{ cursor: 'pointer' }}
    >
      <InfoLabel label={label} onInfo={onInfo} />
      <div style={{ height: 6 }} />
      <AnimatedNumber
        value={value}
        format={format}
        style={{ fontFamily: 'var(--font-sans)', fontSize: size, fontWeight: 600, color, lineHeight: 1, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}
      />
      <div style={{ height: 4 }} />
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: subColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
    </motion.div>
  );
}

function MinorStat({ label, value, format, onInfo }) {
  return (
    <motion.div whileTap={{ scale: 0.97 }} onClick={onInfo} style={{ cursor: 'pointer' }}>
      <InfoLabel label={label} onInfo={onInfo} />
      <div style={{ height: 4 }} />
      <AnimatedNumber value={value} format={format} style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }} />
    </motion.div>
  );
}

// ── MetricWhyModal ─────────────────────────────────────────────────────────────
// The bottom-sheet that shows how each metric is calculated
export function MetricWhyModal({ metricKey, metrics: m, breakdown: b, onClose }) {
  const navigate = useNavigate();
  if (!metricKey) return null;
  const nb = (k) => Number(b?.[k] ?? 0);
  const nm = (k) => Number(m?.[k] ?? 0);
  const trees = Math.round(nb('trees')), stops = Math.round(nb('stops')), roof = Math.round(nb('roof_m2'));
  const mat = nb('maturity');
  const matPct = `${Math.round(mat * 100)}%`;
  const unitCost = b?.unit_cost ?? {};
  const costParts = b?.cost_parts ?? {};

  const configs = {
    cooling: {
      title: 'Cooling', accent: 'Cooling',
      what: 'How much cooler it gets where people are: averaged over the streets, parks and open ground of the block (10 m cells).',
      rule: `Each tree cools its own cell by up to ${nb('tree_cool_c')} °C when fully grown, fading out over about ${nb('tree_reach_m')} m. A cool roof makes the roof itself about ${nb('roof_surface_c')} °C cooler. Trees grow into their effect: about 34% by year 5, 57% by year 10 and 81% by year 20.`,
      rows: [
        ['Trees · cool roofs', `${trees} · ${roof > 0 ? `${roof} m²` : '0'}`],
        ['Tree growth (year)', matPct],
        ['Most-cooled street spot', `${Math.abs(nm('peak_reduction_c')) >= 0.005 ? '−' : ''}${Math.abs(nm('peak_reduction_c')).toFixed(2)}°`],
        ['Street cooling, average', `${Math.abs(nm('temp_reduction_c')) >= 0.0005 ? '−' : ''}${Math.abs(nm('temp_reduction_c')).toFixed(3)}°`],
      ],
    },
    aqi: {
      title: 'Air quality', accent: 'Air',
      what: "The change in the block's air-quality index from leaves trapping fine dust (PM2.5). Negative is better.",
      rule: `Trees clean air, but slowly. We scale the best-case canopy improvement to your plan, counting ${nb('canopy_m2_per_tree')} m² of crown per grown tree.`,
      rows: [
        ['Trees × growth', `${trees} × ${matPct}`],
        ['Canopy added', `${nb('added_canopy_pct')}%`],
        ['AQI change', `${Math.abs(nm('aqi_change')).toFixed(2)}`],
      ],
    },
    co2: {
      title: 'CO₂ captured', accent: 'CO₂',
      what: 'Carbon dioxide the trees pull out of the air each year.',
      rule: `A fully grown street tree takes up about ${nb('tree_co2_kg')} kg of CO₂ a year. Young trees count in proportion to how grown they are.`,
      rows: [
        ['Trees', `${trees}`],
        ['kg per tree per year', `${nb('tree_co2_kg')}`],
        ['× growth', matPct],
        ['= per year', `${nm('co2_captured_kg_per_year').toFixed(0)} kg`],
      ],
    },
    exposure: {
      title: 'Heat exposure', accent: 'exposure',
      what: 'The share of outdoor space (streets, parks, open ground) that is still dangerously hot.',
      rule: `"Dangerously hot" means hotter than ${nb('hot_threshold_c')} °C. A shaded bus stop removes its cell from the count.`,
      rows: [
        ['Outdoor cells', `${nb('outdoor_cells')}`],
        ['Too hot today', `${nb('exposed_before')}`],
        ['Too hot with the plan', `${nb('exposed_after')}`],
        ['= still exposed', `${nm('heat_exposure_pct')}%`],
      ],
    },
    cost: {
      title: 'Cost', accent: 'Cost',
      what: 'What the plan would cost to build, before vendor quotes.',
      rule: `Trees ${inr(unitCost.tree ?? 0)} each. Cool-roof coating ${inr(unitCost.cool_roof ?? 0)} per m². Shaded bus stop ${inr(unitCost.shade_stop ?? 0)} each.`,
      rows: [
        [`${trees} trees`, inr(costParts.tree ?? 0)],
        [`${roof} m² of roof`, inr(costParts.cool_roof ?? 0)],
        [`${stops} bus stops`, inr(costParts.shade_stop ?? 0)],
        ['= total', inr(nm('total_cost_inr'))],
      ],
    },
    per_degree: {
      title: '₹ per °C', accent: '°C',
      what: 'Value for money: how many rupees buy one degree of street-level cooling. Lower is better.',
      rule: 'Total cost divided by the average street cooling.',
      rows: [
        ['Total cost', inr(nm('total_cost_inr'))],
        ['÷ street cooling', `${nm('temp_reduction_c').toFixed(3)} °C`],
        ['= per °C', m?.cost_per_degree_inr == null ? '—' : inr(nm('cost_per_degree_inr'))],
      ],
    },
  };

  const cfg = configs[metricKey] ?? configs.cooling;

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ padding: '0 4px 28px' }}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>How is this calculated?</span>
          <div style={{ height: 14 }} />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1.02 }}>{cfg.title}.</span>
        </div>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--ink-soft)', lineHeight: 1.55, marginBottom: 16 }}>{cfg.what}</p>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--ink-soft)', lineHeight: 1.55 }}>{cfg.rule}</p>
        <div style={{ marginTop: 22, marginBottom: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>YOUR PLAN, RIGHT NOW</div>
        {cfg.rows.map(([k, v], i) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14.5, color: i === cfg.rows.length - 1 ? 'var(--ink)' : 'var(--ink-soft)' }}>{k}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: i === cfg.rows.length - 1 ? 'var(--accent)' : 'var(--ink)', fontWeight: i === cfg.rows.length - 1 ? 600 : 400 }}>{v}</span>
          </div>
        ))}
        <div style={{ height: 18 }} />
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          Estimates from the LeafIt grid model. Every coefficient has a source; tap below to see them.
        </p>
        <div style={{ height: 12 }} />
        <Pill
          label="All assumptions"
          icon={ArrowRight}
          kind="outline"
          dense
          onClick={() => {
            onClose?.();
            navigate('/assumptions');
          }}
        />
      </div>
    </BottomSheet>
  );
}

// ── BottomSheet ─────────────────────────────────────────────────────────────────
export function BottomSheet({ children, onClose, width = 640 }) {
  const wide = window.innerWidth >= 1000;   // desktop: a centred dialog; phones: a sheet from the bottom
  // A dialog: Esc closes it, and focus moves inside so keyboard users land in the sheet, not behind it.
  const panel = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    panel.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: wide ? 'center' : 'flex-end', justifyContent: 'center', padding: wide ? 32 : 0 }}
    >
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        initial={wide ? { opacity: 0, scale: 0.97, y: 12 } : { y: '100%' }}
        animate={wide ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
        exit={wide ? { opacity: 0, scale: 0.97, y: 12 } : { y: '100%' }}
        transition={wide ? { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] } : { type: 'spring', damping: 30, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative', background: 'var(--surface)', borderRadius: wide ? 24 : '28px 28px 0 0',
          border: '1px solid var(--rule)', boxShadow: wide ? 'var(--shadow)' : undefined,
          width: '100%', maxWidth: wide ? width : 640, maxHeight: wide ? '86vh' : '90vh',
          overflowY: 'auto', paddingTop: wide ? 20 : 8, outline: 'none',
        }}
      >
        <button onClick={onClose} aria-label="Close" title="Close (Esc)"
          style={{ position: 'absolute', top: 14, right: 14, width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--rule)', display: 'grid', placeItems: 'center', color: 'var(--ink)', zIndex: 1 }}>
          <X size={16} aria-hidden="true" />
        </button>
        {!wide && <div style={{ width: 48, height: 4, borderRadius: 2, background: 'var(--rule)', margin: '8px auto 16px' }} />}
        <div style={{ padding: '0 24px 24px' }}>
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}
