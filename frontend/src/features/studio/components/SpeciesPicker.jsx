import { ChevronDown } from 'lucide-react';
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
      <span style={{ position: 'relative', display: 'block' }}>
        {/* the browser's own arrow is hidden: it ignores padding and the theme */}
        <select className="field" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Tree species"
          style={{ appearance: 'none', WebkitAppearance: 'none', width: '100%', height: compact ? 34 : 40, padding: '0 34px 0 12px', borderRadius: compact ? 999 : 10,
            border: '1px solid var(--rule)', background: 'var(--sunk)', color: 'var(--ink)', fontSize: 13, cursor: 'pointer', textOverflow: 'ellipsis', transition: 'border-color 0.15s, box-shadow 0.15s' }}>
          <option value={AUTO}>Auto: best fit for each spot</option>
          {opts.map((o) => <option key={o.id} value={o.id}>{o.common}{o.suitable ? '' : ' (less suited here)'}</option>)}
        </select>
        <ChevronDown size={16} aria-hidden="true" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
      </span>
      {!compact && (
        <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.35 }}>
          {picked ? `${picked.scientific}. ${picked.size_class} crown, ${picked.growth} growing${picked.suitable ? '' : `; not tagged for ${CLIMATE[climate] ?? 'this'} climates`}.`
            : `Chosen per spot from species that suit${climate ? ` a ${CLIMATE[climate]} climate` : ' the climate'}.`}
        </span>
      )}
    </label>
  );
}
