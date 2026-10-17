import { motion } from 'framer-motion';

export function CircleBtn({ icon: Icon, tooltip, onClick, filled = false, disabled = false }) {
  return (
    <motion.button
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={filled || undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      whileTap={!disabled ? { scale: 0.9 } : {}}
      style={{
        width: 40, height: 40, flexShrink: 0, borderRadius: '50%',   // never squeezed into an oval by a crowded bar
        border: `1px solid ${filled ? 'var(--accent)' : 'var(--rule)'}`,
        background: filled ? 'var(--accent)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: filled ? 'var(--on-accent)' : 'var(--ink)',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {Icon && <Icon size={18} aria-hidden="true" />}
    </motion.button>
  );
}
