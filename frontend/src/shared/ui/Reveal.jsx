import { motion } from 'framer-motion';

// Fade-up entrance, mirrors Flutter's Reveal widget
export function Reveal({ children, delay = 0, dy = 14, duration = 0.7, className = '' }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: dy }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, delay, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}
