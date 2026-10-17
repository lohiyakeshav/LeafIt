import { LABEL } from '../../../shared/ui';

/** How grown the trees are: drag to watch the same plan mature (shade and cooling follow). */
export function YearSlider({ value, onChange, min = 1, max = 20 }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={LABEL}>TREES AT</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink)' }}>year {value}</span>
      </span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Years after planting"
        style={{ width: '100%', accentColor: 'var(--accent)' }} />
      <span style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
        <span>saplings</span><span>grown</span>
      </span>
    </label>
  );
}
