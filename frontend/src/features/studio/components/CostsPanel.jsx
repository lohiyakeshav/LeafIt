import { useState } from 'react';
import { LABEL } from '../../../shared/ui';
import { inr, currencySymbol, displayCurrency, toDisplay, fromDisplay } from '../../../shared/lib/format.js';
import { TYPES } from '../../../model/rules.js';
import { DEFAULT_BUDGET, PRICE_FIELDS } from '../config.js';

/** Editable prices and budget. Defaults are the sourced figures; every number on every page recalculates from these. */
export function CostsPanel({ unitCost, budget, onPrice, onBudget, onReset, compact }) {
  const custom = unitCost && Object.keys(unitCost).length > 0 || budget !== DEFAULT_BUDGET;
  return (
    <section aria-labelledby="costs-h">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <h2 id="costs-h" style={{ ...LABEL, fontWeight: 400 }}>COSTS &amp; BUDGET</h2>
        {custom && <button onClick={onReset} style={{ ...LABEL, color: 'var(--accent)', padding: '4px 0' }}>RESET</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : '1fr', gap: 6 }}>
        {PRICE_FIELDS.map((f) => (
          <MoneyField key={f.key} id={`price-${f.key}`} label={f.label} unit={f.unit} min={f.min} max={f.max}
            value={unitCost?.[f.key] ?? TYPES[f.key].cost} isDefault={unitCost?.[f.key] == null}
            onChange={(v) => onPrice(f.key, v)} />
        ))}
        <MoneyField id="price-budget" label="Budget" unit="total" min={10_000} max={1_000_000_000}
          value={budget} isDefault={budget === DEFAULT_BUDGET} onChange={onBudget} />
      </div>
      <p style={{ marginTop: 6, fontSize: 11, lineHeight: 1.4, color: 'var(--muted)' }}>Every cost, the bill of materials, the proposal and the AI plan use these.</p>
    </section>
  );
}

/** A ₹ amount on one line: Indian digit grouping while idle, plain digits while typing; out-of-range values are refused. */
// Values are stored in INR; the field shows and accepts the display currency (converted at today's rate).
const group = (n) => Number(n).toLocaleString(displayCurrency().code === 'INR' ? 'en-IN' : 'en', { maximumFractionDigits: n < 100 ? 2 : 0 });
function MoneyField({ id, label, unit, value, min, max, isDefault, onChange }) {
  const [text, setText] = useState(null);           // null = not editing
  const shown = toDisplay(value);
  const n = Number((text ?? '').replace(/[^\d.]/g, ''));   // grouping commas typed or shown are ignored
  const inInr = fromDisplay(n);
  const bad = text !== null && (!text || !(n > 0) || inInr < min * 0.999 || inInr > max * 1.001);
  const commit = () => { if (text !== null && !bad && Math.abs(inInr - value) > 0.005) onChange(Math.round(inInr * 100) / 100); setText(null); };
  return (
    <label htmlFor={id} title={bad ? `Between ${inr(min)} and ${inr(max)}` : `${inr(value)} ${unit}`}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 10, border: `1px solid ${bad ? 'var(--warn)' : 'var(--rule)'}`, background: 'var(--sunk)' }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {label}{!isDefault && <span aria-label="edited" style={{ color: 'var(--accent)' }}> ●</span>}
        <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontWeight: 400, fontSize: 10, color: bad ? 'var(--warn)' : 'var(--muted)' }}>{bad ? `${inr(min)}–${inr(max)}` : unit}</span>
      </span>
      <span aria-hidden="true" style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--muted)' }}>{currencySymbol()}</span>
      <input id={id} aria-invalid={bad} aria-label={`${label}, ${displayCurrency().code} ${unit}`}
        value={text ?? group(shown)}
        onFocus={(e) => { setText(group(shown)); e.target.select(); }}   // same text as shown, so the selection sticks
        onChange={(e) => setText(e.target.value.replace(/[^\d,.]/g, ''))}
        onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(null); e.currentTarget.blur(); } }}
        inputMode="decimal" style={{ width: 86, textAlign: 'right', background: 'transparent', border: 'none', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', padding: '4px 0' }} />
    </label>
  );
}
