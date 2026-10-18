import { LABEL } from '../ui';

const t1 = (v) => `${Number(v).toFixed(1)}°`;

/**
 * Ground temperature today → with the plan, in plain degrees: the whole area, the hottest tenth of the ground, and each landmark.
 * Same numbers as the cooling figures (they are the difference), shown the way people say it: "it was 42.7°, now 42.1°".
 * With-plan values use the high end of the published cooling estimates, as the headline does; the footnote gives the low end.
 */
export function TempsTable({ temps, landmarkLimit = Infinity }) {
  if (!temps?.area) return null;
  const places = Object.entries(temps.landmarks ?? {}).sort((a, b) => (b[1].before - b[1].after) - (a[1].before - a[1].after)).slice(0, landmarkLimit);
  const rows = [['Whole area', temps.area], temps.hottest && ['Hottest tenth of the ground', temps.hottest], ...places].filter(Boolean);
  return (
    <div>
      <div style={{ ...LABEL, marginBottom: 4 }}>GROUND TEMPERATURE · TODAY → WITH PLAN</div>
      {rows.map(([name, t]) => (
        <div key={name} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'baseline', padding: '9px 0', borderBottom: '1px solid var(--rule)', fontSize: 13.5 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, whiteSpace: 'nowrap' }}>
            <span style={{ color: 'var(--muted)' }}>{t1(t.before)}</span> → <span style={{ color: t.before - t.after >= 0.05 ? 'var(--accent)' : 'var(--ink)', fontWeight: 600 }}>{t1(t.after)}</span>
          </span>
        </div>
      ))}
      <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.45, color: 'var(--muted)' }}>
        Satellite surface temperature, hot-season average. With the plan = high end of published estimates (low end, whole area: {t1(temps.area.after_low)}). Landmarks: within about 50 m.
      </div>
    </div>
  );
}
