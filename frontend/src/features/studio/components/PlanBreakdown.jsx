import { SPECIES_BY_ID } from '../../../model/rules.js';
import { LABEL } from '../../../shared/ui';

const speciesName = (id) => SPECIES_BY_ID[id]?.common ?? (id === 'generic' ? 'Any shade tree' : id);
const mix = (species) => Object.entries(species ?? {}).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${speciesName(id)} ${n}`).join(', ');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** What an AI plan puts where (the server's `summary` of one option): totals, the species mix, and each zone's share.
 *  `onShowZone(zone)` adds a "Show" link that highlights the zone on the map. */
export function PlanBreakdown({ summary, onShowZone }) {
  if (!summary) return null;
  const totals = [
    summary.trees && plural(summary.trees, 'tree', 'trees'),
    summary.cool_roofs && plural(summary.cool_roofs, 'cool roof', 'cool roofs'),
    summary.shade_stops && plural(summary.shade_stops, 'shaded bus stop', 'shaded bus stops'),
  ].filter(Boolean);
  return (
    <div>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{totals.join(' · ') || 'Nothing placed'}</div>
      {summary.trees > 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 3 }}>Species: {mix(summary.species)}</div>}
      <div style={{ ...LABEL, marginTop: 12, marginBottom: 4 }}>WHAT GOES WHERE</div>
      {summary.zones.map((z) => {
        const bits = [
          z.trees && `${plural(z.trees, 'tree', 'trees')} (${mix(z.species)})`,
          z.cool_roofs && plural(z.cool_roofs, 'cool roof', 'cool roofs'),
          z.shade_stops && plural(z.shade_stops, 'bus shelter', 'bus shelters'),
        ].filter(Boolean);
        const near = [...(z.roads ?? []), ...(z.landmarks ?? [])].slice(0, 3);
        return (
          <div key={z.zone} style={{ padding: '7px 0', borderBottom: '1px solid var(--rule)', fontSize: 12.5, lineHeight: 1.45 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <b style={{ flex: 1, textTransform: 'capitalize' }}>{z.label} ({z.zone})</b>
              {onShowZone && <button onClick={() => onShowZone(z.zone)} aria-label={`Show the ${z.label} on the map`} style={{ cursor: 'pointer', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>Show</button>}
            </div>
            <div style={{ color: 'var(--ink-soft)' }}>{bits.join(' · ')}</div>
            {near.length > 0 && <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>near {near.join(', ')}</div>}
          </div>
        );
      })}
    </div>
  );
}
