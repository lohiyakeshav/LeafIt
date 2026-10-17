import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { onToast } from './toast.js';

/** Renders the current toast. Mounted once in App; components call useToast() / showToast() to show one. */
export function ToastProvider() {
  const [toast, setToast] = useState(null);
  useEffect(() => onToast(setToast), []);
  useEffect(() => {
    if (!toast) return;
    const tid = setTimeout(() => setToast(null), toast.duration);
    return () => clearTimeout(tid);
  }, [toast]);
  return (
    <motion.div
      key={toast?.id}
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={toast ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 20, scale: 0.95 }}
      style={{
        position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
        zIndex: 9999, pointerEvents: 'none',
      }}
    >
      {toast && (
        <div role="status" aria-live="polite" style={{
          background: 'var(--ink)', color: 'var(--page)',
          fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500,
          padding: '10px 20px', borderRadius: 999,
          boxShadow: 'var(--shadow)',
          whiteSpace: 'nowrap',
        }}>
          {toast.msg}
        </div>
      )}
    </motion.div>
  );
}
