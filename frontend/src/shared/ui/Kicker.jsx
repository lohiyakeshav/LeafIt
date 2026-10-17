import { motion } from 'framer-motion';

export function PulseDot({ color = 'var(--accent)', size = 7 }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: size, height: size }}>
      <motion.span
        animate={{ scale: [1, 2.6, 1], opacity: [0.5, 0, 0.5] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
        style={{
          position: 'absolute', inset: 0,
          borderRadius: '50%', background: color,
        }}
      />
      <span style={{
        position: 'absolute', inset: 0,
        borderRadius: '50%', background: color,
      }} />
    </span>
  );
}

export function Kicker({ children, dot = true, color = 'var(--muted)' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {dot && <PulseDot />}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color, lineHeight: 1.35 }}>
        {children}
      </span>
    </div>
  );
}
