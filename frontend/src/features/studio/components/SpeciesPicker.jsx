import { AUTO, speciesOptions } from '../../../model/species.js';
import { LABEL } from '../../../shared/ui';

const CLIMATE = { hot_dry: 'hot and dry', composite: 'composite', humid: 'humid' };

/** What the tree tool plants. "Auto" matches the planner: the best-fitting species for each spot and this climate. */
export function SpeciesPicker({ value, onChange, climate, compact = false }) {
  const opts = speciesOptions(climate);
  const picked = opts.find((o) => o.id === value);
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      {!compact && <span style={LABEL}>TREE SPECIES</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Tree species"
        style={{ width: '100%', height: compact ? 34 : 40, padding: '0 10px', borderRadius: compact ? 999 : 12, border: '1px solid var(--rule)', background: 'var(--sunk)', color: 'var(--ink)', fontSize: 13 }}>
        <option value={AUTO}>Auto: best fit for each spot</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.common}{o.suitable ? '' : ' (less suited here)'}</option>)}
      </select>
      {!compact && (
        <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.35 }}>
          {picked ? `${picked.scientific}. ${picked.size_class} crown, ${picked.growth} growing${picked.suitable ? '' : `; not tagged for ${CLIMATE[climate] ?? 'this'} climates`}.`
            : `Chosen per spot from species that suit${climate ? ` a ${CLIMATE[climate]} climate` : ' the climate'}.`}
        </span>
      )}
    </label>
  );
}
