import { motion } from 'framer-motion';
import { Spinner } from './Spinner.jsx';

export function Pill({ label, icon: Icon, onClick, kind = 'solid', loading = false, dense = false, expand = false, disabled = false, height }) {
  const solid = kind === 'solid';
  const fg = solid ? 'var(--on-accent)' : 'var(--ink)';
  const bg = solid ? 'var(--accent)' : kind === 'outline' ? 'transparent' : 'var(--surface-hi)';
  const border = kind === 'outline' ? '1px solid var(--rule)' : 'none';
  const h = height ?? (dense ? 38 : 48);
  const px = dense ? 14 : 20;

  return (
    <motion.button
      onClick={disabled || loading ? undefined : onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
      whileTap={!disabled && !loading ? { scale: 0.96 } : {}}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: dense ? 6 : 8,
        height: h, padding: `0 ${px}px`,
        background: bg, border, borderRadius: 999,
        color: fg, width: expand ? '100%' : undefined,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled || loading ? 'default' : 'pointer',
        transition: 'background 0.22s, opacity 0.22s',
      }}
    >
      {loading
        ? <Spinner size={16} color={fg} />
        : Icon && <Icon size={dense ? 16 : 18} color={fg} />
      }
      <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 550, fontSize: dense ? 13 : 14.5, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </motion.button>
  );
}
