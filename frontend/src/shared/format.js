// Format helpers — mirrors app/lib/format.dart
// ₹ in Indian units: ₹45,000 · ₹18.5 L · ₹2.5 Cr

export function inr(v) {
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
