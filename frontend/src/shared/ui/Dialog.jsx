import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

/** Modal dialog: a centred card on desktop, a sheet from the bottom on phones. Esc and the × close it; focus moves inside. */
export function Dialog({ children, onClose, width = 640 }) {
  const wide = window.innerWidth >= 1000;   // desktop: a centred dialog; phones: a sheet from the bottom
  // A dialog: Esc closes it, and focus moves inside so keyboard users land in the sheet, not behind it.
  const panel = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    panel.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: wide ? 'center' : 'flex-end', justifyContent: 'center', padding: wide ? 32 : 0 }}
    >
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        initial={wide ? { opacity: 0, scale: 0.97, y: 12 } : { y: '100%' }}
        animate={wide ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
        exit={wide ? { opacity: 0, scale: 0.97, y: 12 } : { y: '100%' }}
        transition={wide ? { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] } : { type: 'spring', damping: 30, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative', background: 'var(--surface)', borderRadius: wide ? 24 : '28px 28px 0 0',
          border: '1px solid var(--rule)', boxShadow: wide ? 'var(--shadow)' : undefined,
          width: '100%', maxWidth: wide ? width : 640, maxHeight: wide ? '86vh' : '90vh',
          overflowY: 'auto', overflowX: 'hidden', paddingTop: wide ? 20 : 8, outline: 'none',   // wide content scrolls inside itself, never the whole sheet
        }}
      >
        <button onClick={onClose} aria-label="Close" title="Close (Esc)"
          style={{ position: 'absolute', top: 14, right: 14, width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--rule)', display: 'grid', placeItems: 'center', color: 'var(--ink)', zIndex: 1 }}>
          <X size={16} aria-hidden="true" />
        </button>
        {!wide && <div style={{ width: 48, height: 4, borderRadius: 2, background: 'var(--rule)', margin: '8px auto 16px' }} />}
        <div style={{ padding: '0 24px 24px' }}>
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}
