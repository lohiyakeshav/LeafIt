import { motion } from 'framer-motion';

export function Spinner({ size = 24, color = 'var(--accent)' }) {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      style={{
        width: size, height: size, border: `2px solid transparent`,
        borderTopColor: color, borderRadius: '50%',
      }}
    />
  );
}
