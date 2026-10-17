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

export function formatDeg(v, d = 2) {
  return `${Math.abs(v) >= 0.5 / (d === 1 ? 10 : 100) ? '−' : ''}${Math.abs(v).toFixed(d)}°`;
}

export function formatAqi(v) {
  return Math.abs(v) < 0.005 ? '0.00' : Math.abs(v).toFixed(2);
}

export function formatTons(kg) {
  return `${(kg / 1000).toFixed(1)} t`;
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
