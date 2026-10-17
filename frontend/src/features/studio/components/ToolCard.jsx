import { motion } from 'framer-motion';

/** One placement tool (tree, roof, bus stop, erase): a card in the desktop rail, a compact button in the phone dock. */
export function ToolCard({ tool: t, active, compact, onClick }) {
  const Icon = t.icon;
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      aria-pressed={active}
      style={{
        display: 'flex', alignItems: compact ? 'center' : 'flex-start', gap: compact ? 5 : 6, textAlign: 'left',
        flexDirection: 'column', justifyContent: 'center',
        padding: compact ? '8px 2px' : '10px 12px', borderRadius: 14,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--rule)'}`,
        background: active ? 'var(--accent-soft)' : 'transparent',
        transition: 'border-color 0.2s, background 0.2s',
      }}
    >
      <Icon size={18} color={active ? 'var(--accent)' : 'var(--ink)'} aria-hidden="true" />
      <div style={{ minWidth: 0, textAlign: compact ? 'center' : 'left' }}>
        <div style={{ fontSize: compact ? 12 : 13.5, fontWeight: 600, letterSpacing: '-0.01em', color: active ? 'var(--accent)' : 'var(--ink)' }}>{t.short === 'Shade' && !compact ? 'Bus stop' : t.short}</div>
        {!compact && <div style={{ marginTop: 2, fontSize: 11, color: 'var(--muted)', lineHeight: 1.3 }}><span className="sr-only">{t.label}. Shortcut {t.key}. </span>{t.hint}</div>}
      </div>
    </motion.button>
  );
}

/** Secondary actions: a quiet text row in the rail, an outlined chip on phones. */
export function ExtraBtn({ icon: Icon, label, active, onClick, compact }) {
  return (
    <button onClick={onClick} title={label} aria-pressed={active}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: compact ? 'center' : 'flex-start', gap: compact ? 6 : 10, whiteSpace: 'nowrap',
        flex: compact ? 1 : undefined, height: compact ? 34 : undefined, padding: compact ? 0 : '8px 14px', borderRadius: compact ? 999 : 12,
        border: `1px solid ${active ? 'var(--accent)' : compact ? 'var(--rule)' : 'transparent'}`,
        color: active ? 'var(--accent)' : 'var(--ink-soft)', fontSize: 13,
      }}>
      <Icon size={16} />
      {label}
    </button>
  );
}
