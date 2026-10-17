import { motion } from 'framer-motion';

export function PillToggle({ options, value, onChange, dense = false, expand = false, bare = false }) {
  const h = dense ? 34 : 44;
  return (
    <div role="group" style={{
      display: 'flex', height: h, padding: 3,
      background: bare ? 'transparent' : 'var(--sunk)',
      border: bare ? 'none' : '1px solid var(--rule)',
      borderRadius: 999, position: 'relative', width: expand ? '100%' : undefined,
    }}>
      {options.map(({ value: v, label, icon: Icon }) => {
        const active = v === value;
        return (
          <motion.button
            key={v}
            onClick={() => onChange(v)}
            aria-pressed={active}
            style={{
              flex: expand ? 1 : undefined,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: `0 ${dense ? 12 : 16}px`,
              borderRadius: 999, border: 'none',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? 'var(--on-accent)' : 'var(--ink)',
              fontFamily: dense ? 'var(--font-mono)' : 'var(--font-sans)',
              fontSize: dense ? 11.5 : 13.5,
              fontWeight: dense ? 500 : 550,
              whiteSpace: 'nowrap',
              transition: 'all 0.22s ease',
              cursor: 'pointer',
            }}
          >
            {Icon && <Icon size={dense ? 14 : 16} />}
            {label}
          </motion.button>
        );
      })}
    </div>
  );
}
