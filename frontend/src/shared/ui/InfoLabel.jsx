import { Info } from 'lucide-react';

export function InfoLabel({ label, onInfo }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <button onClick={(e) => { e.stopPropagation(); onInfo?.(); }} style={{ cursor: 'pointer', color: 'var(--muted)', lineHeight: 0, padding: 4, borderRadius: 4 }} title={`How is ${label} calculated?`} aria-label={`How is ${label.toLowerCase()} calculated?`}>
        <Info size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
