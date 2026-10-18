// Format helpers — mirrors app/lib/format.dart
// ₹ in Indian units: ₹45,000 · ₹18.5 L · ₹2.5 Cr

// Display currency. Every amount in the app is computed in INR; `inr()` converts at today's rate when another currency
// is chosen. Set by app/currency.js before React re-renders, so every caller picks it up without changes.
const CUR = { code: 'INR', rate: 1 };
export function setDisplayCurrency(code, rate) { CUR.code = code; CUR.rate = rate; }
export const displayCurrency = () => ({ ...CUR });
export const toDisplay = (inrAmount) => inrAmount * CUR.rate;
export const fromDisplay = (amount) => amount / CUR.rate;
export const currencySymbol = (code = CUR.code) =>
  new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: DISPLAY(code) }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? code;
// ₹ / $ / € / £ / ¥ / ₽ read cleanly on their own; everything else uses an unambiguous symbol (CN¥, A$, CA$, AED…)
const NARROW = new Set(['INR', 'USD', 'EUR', 'GBP', 'JPY', 'RUB']);
const DISPLAY = (code) => (NARROW.has(code) ? 'narrowSymbol' : 'symbol');

/** Money: INR in Indian units (₹45,000 · ₹18.5 L · ₹2.5 Cr); other currencies converted, compact above 100k ($25.1K, ¥3.3M). */
export function inr(v) {
  if (CUR.code !== 'INR') return money(v * CUR.rate, CUR.code);
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${_short(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}₹${_short(a / 1e5)} L`;
  const s = Math.round(a).toString();
  return `${sign}₹${s.length > 3 ? s.slice(0, s.length - 3) + ',' + s.slice(-3) : s}`;
}

function _short(x) {
  const s = x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** A cooling figure: "−0.15°", or "0.00°" when it rounds to nothing (no sign on a zero). */
export function formatDeg(v, d = 2) {
  const x = Math.abs(Number(v ?? 0));
  return `${x >= 0.5 * 10 ** -d ? '−' : ''}${x.toFixed(d)}°`;
}

/**
 * A cooling figure as the published range, e.g. "−0.02 to −0.15°". Studies of tree cooling differ ~8×, so the simulator
 * returns the high end in `m[key]` and the low end in `m.low_estimate[key]` (Method page: "Tree cooling" and "Stacking").
 */
export function degRange(m, key, d = 2) {
  const hi = Math.abs(Number(m?.[key] ?? 0)), lo = Math.abs(Number(m?.low_estimate?.[key] ?? hi));
  if (hi < 0.5 * 10 ** -d || lo.toFixed(d) === hi.toFixed(d)) return formatDeg(hi, d);
  return `−${lo.toFixed(d)} to −${hi.toFixed(d)}°`;
}

/** Cost per °C over the same range: cheapest at the high end of cooling, dearest at the low end. */
export function perDegreeRange(m, inr) {
  const hi = m?.cost_per_degree_inr, lo = m?.low_estimate?.cost_per_degree_inr;
  if (hi == null) return '—';
  return lo == null || inr(lo) === inr(hi) ? inr(hi) : `${inr(hi)}–${inr(lo)}`;
}

/** Share of outdoors still too hot, over the range (fewer cells cool below the threshold at the low end). */
export function exposureRange(m) {
  const hi = Math.round(Number(m?.heat_exposure_pct ?? 0)), lo = Math.round(Number(m?.low_estimate?.heat_exposure_pct ?? hi));
  return lo === hi ? `${hi}%` : `${hi}–${lo}%`;
}

/** An AQI change: "−0.02" (lower is cleaner), or "0.00". */
export function formatAqi(v) {
  const x = Math.abs(Number(v ?? 0));
  return x < 0.005 ? '0.00' : `−${x.toFixed(2)}`;
}

/** CO₂ in tonnes: "12.7 t". */
export function formatTons(kg) {
  return `${(Number(kg ?? 0) / 1000).toFixed(1)} t`;
}

export function delhiTime() {
  const t = new Date(Date.now() + 5.5 * 3600 * 1000);
  const h = t.getUTCHours() % 12 || 12;
  const m = String(t.getUTCMinutes()).padStart(2, '0');
  const ampm = t.getUTCHours() < 12 ? 'am' : 'pm';
  return `${h}:${m} ${ampm}`;
}

function money(x, code) {
  const a = Math.abs(x);
  return new Intl.NumberFormat('en', {
    style: 'currency', currency: code, currencyDisplay: DISPLAY(code),
    notation: a >= 1e5 ? 'compact' : 'standard',
    maximumFractionDigits: a >= 1e5 ? 2 : a >= 100 ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(x);
}
