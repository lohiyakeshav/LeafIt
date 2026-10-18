import { Plus, X } from 'lucide-react';
import { LABEL } from '../../../shared/ui';
import { degRange, formatDeg, formatTons, inr } from '../../../shared/lib/format.js';

/** Saved plan variants: save the current plan, load one back, compare them all. */
export function PlanOptions({ options, canSave, onSave, onLoad, onRemove, onCompare }) {
  return (
    <section aria-labelledby="options-h">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 id="options-h" style={{ ...LABEL, fontWeight: 400 }}>PLAN OPTIONS</h2>
        {options.length + (canSave ? 1 : 0) >= 2 && <button onClick={onCompare} style={{ ...LABEL, color: 'var(--accent)', padding: '6px 0' }}>COMPARE {options.length + (canSave ? 1 : 0)} →</button>}
      </div>
      {options.map((o) => (
        <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--rule)', fontSize: 13.5 }}>
          <button onClick={() => onLoad(o)} title={`Load ${o.label}`} style={{ textAlign: 'left', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {o.label} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)' }}>· {o.items.length} items · yr {o.years}</span>
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--accent)' }}>{degRange(o.metrics, 'temp_reduction_c')}</span>
          <button onClick={() => onRemove(o)} aria-label={`Delete ${o.label}`} title="Delete" style={{ color: 'var(--muted)', padding: 4, lineHeight: 0 }}><X size={14} /></button>
        </div>
      ))}
      <button onClick={canSave ? onSave : undefined} disabled={!canSave}
        style={{ marginTop: 10, width: '100%', padding: '10px 14px', borderRadius: 12, border: '1px dashed var(--rule)', color: canSave ? 'var(--ink)' : 'var(--muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: canSave ? 'pointer' : 'default' }}>
        <Plus size={15} aria-hidden="true" /> {options.length ? 'Save this plan as another option' : 'Save this plan to compare'}
      </button>
    </section>
  );
}

const ROWS = [
  ['Street cooling', (m) => m.temp_reduction_c, formatDeg, 'max'],
  ['Hottest spot', (m) => m.peak_reduction_c, (v) => formatDeg(v, 1), 'max'],
  ['Still too hot', (m) => m.heat_exposure_pct, (v) => `${Math.round(v)}%`, 'min'],
  ['CO₂ per year', (m) => m.co2_captured_kg_per_year, formatTons, 'max'],
  ['Cost', (m) => m.total_cost_inr, inr, 'min'],
  ['Cost per °C', (m) => m.cost_per_degree_inr, (v) => (v == null ? '—' : inr(v)), 'min'],
];

const PINNED = { position: 'sticky', left: 0, zIndex: 1, background: 'var(--surface)' };   // the row-name column, kept in view while scrolling sideways

/** Side-by-side table; the best value in each row is highlighted. */
export function CompareTable({ options, current }) {
  const cols = [...options, ...(current?.metrics ? [current] : [])];
  return (
    <div style={{ padding: '0 4px 24px' }}>
      <div style={{ ...LABEL, marginBottom: 10 }}>COMPARE PLANS</div>
      {/* phones: swipe through the plans while the row names stay pinned on the left */}
      <div style={{ overflowX: 'auto', scrollbarWidth: 'thin' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...PINNED, textAlign: 'left', padding: '8px 0' }} />
              {cols.map((c) => <th key={c.id ?? c.label} scope="col" style={{ textAlign: 'right', verticalAlign: 'bottom', padding: '8px 0 8px 16px', fontSize: 14, fontWeight: 600, minWidth: 104, maxWidth: 170 }}>{c.label}<div style={{ ...LABEL, fontSize: 10.5 }}>YEAR {c.years}</div></th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([name, get, fmt, better]) => {
              const vals = cols.map((c) => (c.metrics ? get(c.metrics) : null));
              const nums = vals.filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
              const best = nums.length > 1 ? (better === 'max' ? Math.max(...nums) : Math.min(...nums)) : null;
              return (
                <tr key={name} style={{ borderTop: '1px solid var(--rule)' }}>
                  <th scope="row" style={{ ...PINNED, textAlign: 'left', padding: '11px 12px 11px 0', fontSize: 13.5, fontWeight: 400, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{name}</th>
                  {vals.map((v, i) => {
                    const win = best != null && v != null && fmt(v) === fmt(best);   // ties as displayed, not to the 5th decimal
                    return <td key={i} style={{ textAlign: 'right', padding: '11px 0 11px 16px', fontFamily: 'var(--font-mono)', fontSize: 13, color: win ? 'var(--accent)' : 'var(--ink)', fontWeight: win ? 600 : 400 }}>{fmt(v)}{win && <span className="sr-only"> (best)</span>}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 14, fontSize: 12.5, color: 'var(--muted)' }}>Best value in each row is highlighted. Cooling figures here are the high end of the published range, so plans compare like for like. Tap an option in the panel to load it back.</p>
    </div>
  );
}
