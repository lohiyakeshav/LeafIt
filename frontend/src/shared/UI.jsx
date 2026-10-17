import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { inr } from './format.js';

// ── Reveal ──────────────────────────────────────────────────────────────────
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

// ── PulseDot ─────────────────────────────────────────────────────────────────
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

// ── Kicker ───────────────────────────────────────────────────────────────────
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

// ── Pill ─────────────────────────────────────────────────────────────────────
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

// ── CircleBtn ─────────────────────────────────────────────────────────────────
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
        width: 40, height: 40, borderRadius: '50%',
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

// ── PillToggle ─────────────────────────────────────────────────────────────────
export function PillToggle({ options, value, onChange, dense = false, expand = false, bare = false }) {
  const h = dense ? 34 : 44;
  return (
    <div role="group" style={{
      display: 'flex', height: h, padding: 3,
      background: bare ? 'transparent' : 'var(--sunk)',
      border: bare ? 'none' : '1px solid var(--rule)',
      borderRadius: 999, position: 'relative', width: expand ? '100%' : undefined,
    }}>
      {options.map(({ value: v, label, icon: Icon }, i) => {
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

// ── IndexRow ───────────────────────────────────────────────────────────────────
export function IndexRow({ no, title, meta, onTap, busy = false, trailing }) {
  const [hot, setHot] = useState(false);
  return (
    <motion.div
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onClick={onTap}
      whileTap={onTap ? { scale: 0.985 } : {}}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '18px 0',
        borderBottom: '1px solid var(--rule)',
        cursor: onTap ? 'pointer' : 'default',
      }}
    >
      <div style={{ width: 40, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>{no}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 21, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.15, color: hot ? 'var(--accent)' : 'var(--ink)', transition: 'color 0.22s' }}>
          {title}
        </div>
        {meta && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{meta}</div>}
      </div>
      {trailing ?? (
        <motion.div
          animate={{ rotate: hot ? 0 : -45, scale: hot ? 1 : 0.85 }}
          transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {busy
            ? <Spinner size={16} color='var(--on-accent)' />
            : <ArrowRight size={18} color='var(--on-accent)' />
          }
        </motion.div>
      )}
    </motion.div>
  );
}

// ── Glass ──────────────────────────────────────────────────────────────────────
export function Glass({ children, radius = 999, padding = '0', style = {} }) {
  return (
    <div style={{
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      background: 'var(--glass)',
      border: '1px solid var(--rule)',
      borderRadius: radius,
      padding,
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────
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

// ── SectionHead ───────────────────────────────────────────────────────────────
export function SectionHead({ kicker, title, accent, sub, size = 34 }) {
  return (
    <div>
      <Reveal><Kicker>{kicker}</Kicker></Reveal>
      <div style={{ height: 14 }} />
      <Reveal delay={0.08}>
        <AccentText text={title} accent={accent} style={{ fontSize: size, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1.02, fontFamily: 'var(--font-sans)' }} />
      </Reveal>
      {sub && (
        <>
          <div style={{ height: 10 }} />
          <Reveal delay={0.16}>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--ink-soft)', lineHeight: 1.55 }}>{sub}</p>
          </Reveal>
        </>
      )}
    </div>
  );
}

// ── AccentText ─────────────────────────────────────────────────────────────────
export function AccentText({ text, accent, style = {}, color = 'var(--accent)' }) {
  if (!accent || !text.includes(accent)) {
    return <span style={style}>{text}</span>;
  }
  const i = text.indexOf(accent);
  const accentSize = typeof style.fontSize === 'number' ? style.fontSize * 1.12 : '1.12em';
  return (
    <span style={style}>
      {text.slice(0, i)}
      <em style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: accentSize, color, lineHeight: style.lineHeight }}>
        {accent}
      </em>
      {text.slice(i + accent.length)}
    </span>
  );
}

// ── Stat ───────────────────────────────────────────────────────────────────────
export function Stat({ label, value, format, color = 'var(--ink)', size = 26 }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      <div style={{ height: 6 }} />
      <AnimatedNumber value={value} format={format} style={{ fontFamily: 'var(--font-sans)', fontSize: size, fontWeight: 600, color, lineHeight: 1, letterSpacing: '-0.045em' }} />
    </div>
  );
}

// ── AnimatedNumber ─────────────────────────────────────────────────────────────
export function AnimatedNumber({ value, format, style = {} }) {
  const [displayed, setDisplayed] = useState(value);
  const startRef = useRef(value);
  const rafRef = useRef();
  const startTime = useRef();

  useEffect(() => {
    startRef.current = displayed;
    startTime.current = performance.now();
    const from = displayed;
    const to = value;
    const duration = 650;

    function tick(now) {
      const t = Math.min(1, (now - startTime.current) / duration);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setDisplayed(from + (to - from) * ease);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <span style={style}>{format(displayed)}</span>;
}

// ── BudgetBar ──────────────────────────────────────────────────────────────────
export function BudgetBar({ cost, budget }) {
  const over = cost > budget;
  const color = over ? 'var(--warn)' : 'var(--accent)';
  const pct = budget === 0 ? 0 : Math.min(1, cost / budget);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>BUDGET</span>
      <div style={{ flex: 1, height: 4, background: 'var(--rule)', borderRadius: 2, overflow: 'hidden' }}>
        <motion.div
          animate={{ width: `${pct * 100}%` }}
          transition={{ duration: 0.65, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ height: '100%', background: color, borderRadius: 2 }}
        />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: over ? 'var(--warn)' : 'var(--ink)', whiteSpace: 'nowrap', minWidth: 118, textAlign: 'right' }}>
        {inr(cost)} / {inr(budget)}
      </span>
    </div>
  );
}

// ── Marquee ────────────────────────────────────────────────────────────────────
export function Marquee({ words = [], size = 44, seconds = 38 }) {
  const ref = useRef();
  const xRef = useRef(0);
  const rafRef = useRef();
  const [, forceRender] = useState(0);

  const text = words.join(' — ') + ' — ';

  useEffect(() => {
    let last = performance.now();
    function tick(now) {
      const dt = now - last; last = now;
      const el = ref.current;
      if (!el) return;
      xRef.current -= (dt / 1000) * (el.scrollWidth / 2 / seconds);
      if (xRef.current <= -el.scrollWidth / 2) xRef.current = 0;
      el.style.transform = `translateX(${xRef.current}px)`;
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [seconds]);

  return (
    <div style={{ overflow: 'hidden', userSelect: 'none', height: size * 1.2 }}>
      <div
        ref={ref}
        style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', willChange: 'transform' }}
      >
        {[0, 1].map(rep =>
          words.map((w, i) => (
            <span
              key={`${rep}-${i}`}
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: size,
                fontStyle: i % 2 === 1 ? 'italic' : 'normal',
                color: i % 2 === 1 ? 'var(--ink-soft)' : 'var(--ink)', opacity: i % 2 === 1 ? 0.8 : 0.85,
                WebkitTextStroke: i % 2 === 1 ? '1px var(--ink-soft)' : undefined,
                WebkitTextFillColor: i % 2 === 1 ? 'transparent' : undefined,
                marginRight: 24,
              }}
            >
              {w} —
            </span>
          ))
        )}
      </div>
    </div>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────────
let _setToast = null;
export function useToast() {
  return (msg, duration = 2000) => _setToast?.({ msg, duration, id: Date.now() });
}
export function ToastProvider() {
  const [toast, setToast] = useState(null);
  _setToast = setToast;
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

// ── Bullets ────────────────────────────────────────────────────────────────────
export function Bullets({ text, color = 'var(--ink-soft)' }) {
  const lines = text.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.replace(/^([-•*]|\d+\.)\s*/, '').replace(/\*\*/g, ''));
  return (
    <div>
      {lines.map((line, i) => (
        <Reveal key={i} delay={i * 0.09}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)', paddingTop: 3 }}>—</span>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color, lineHeight: 1.55 }}>{line}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

// ── VRule ──────────────────────────────────────────────────────────────────────
export function VRule({ height = 40 }) {
  return <div style={{ width: 1, height, background: 'var(--rule)', flexShrink: 0 }} />;
}

// ── InfoLabel ──────────────────────────────────────────────────────────────────
export function InfoLabel({ label, onInfo }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <button onClick={(e) => { e.stopPropagation(); onInfo?.(); }} style={{ cursor: 'pointer', color: 'var(--muted)', lineHeight: 0, padding: 4, borderRadius: 4 }} title={`How is ${label} calculated?`} aria-label={`How is ${label.toLowerCase()} calculated?`}>
        <InfoIcon size={12} />
      </button>
    </div>
  );
}

// Inline SVG icons to avoid any icon lib conflicts
function ArrowRight({ size = 18, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
    </svg>
  );
}
function InfoIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  );
}

// ── Theme ──────────────────────────────────────────────────────────────────────
// index.html sets data-theme before first paint; this hook flips it and remembers the choice.
export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');
  const toggle = useCallback(() => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('leafit-theme', next); } catch { /* private mode: still switches for this visit */ }
    window.dispatchEvent(new Event('leafit-theme'));
    setTheme(next);
  }, []);
  useEffect(() => {   // keep every toggle on the page in sync
    const on = () => setTheme(document.documentElement.dataset.theme);
    window.addEventListener('leafit-theme', on);
    return () => window.removeEventListener('leafit-theme', on);
  }, []);
  return [theme, toggle];
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const light = theme === 'light';
  return (
    <motion.button
      onClick={toggle}
      whileTap={{ scale: 0.9 }}
      aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
      title={light ? 'Dark theme' : 'Light theme'}
      style={{
        width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--rule)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', flexShrink: 0,
      }}
    >
      <motion.span key={theme} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ duration: 0.3 }} style={{ display: 'flex' }}>
        {light ? <Moon size={17} /> : <Sun size={17} />}
      </motion.span>
    </motion.button>
  );
}

function Sun({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function Moon({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
