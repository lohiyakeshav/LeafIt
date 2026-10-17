import { currencySymbol } from '../lib/format.js';
import { CURRENCIES, useCurrency } from '../../state/currency.js';

// Native <select> (keyboard and screen-reader friendly) dressed as a pill. Amounts are converted for display only.
export function CurrencyPicker() {
  const code = useCurrency((s) => s.code);
  const date = useCurrency((s) => s.date);
  const rates = useCurrency((s) => s.rates);
  const setCode = useCurrency((s) => s.setCode);
  const available = CURRENCIES.filter(([c]) => rates[c]);
  return (
    <label title={date ? `Rates of ${date} (exchangerate-api.com). All figures are computed in INR and converted.` : 'Currency'}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 40, padding: '0 28px 0 12px', borderRadius: 999, border: '1px solid var(--rule)', color: 'var(--ink)', flexShrink: 0, cursor: 'pointer' }}>
      <span className="sr-only">Currency</span>
      <span aria-hidden="true" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, pointerEvents: 'none' }}>{currencySymbol(code)} {code}</span>
      <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ position: 'absolute', right: 11, pointerEvents: 'none' }}><polyline points="6 9 12 15 18 9" /></svg>
      <select value={code} onChange={(e) => setCode(e.target.value)}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', font: 'inherit' }}>
        {available.map(([c, name]) => <option key={c} value={c}>{currencySymbol(c)} {c} · {name}</option>)}
      </select>
    </label>
  );
}
