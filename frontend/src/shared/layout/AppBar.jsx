// Top bar for the desktop pages after the Studio: back, where you are, the three steps of the journey, page actions.
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { CircleBtn, CurrencyPicker } from '../ui';
import { useSession } from '../../state/session.js';
import { useWide } from './useWide.js';

const STEPS = ['Design', 'Review', 'Build'];

export default function AppBar({ step, title, actions }) {
  const navigate = useNavigate();
  const wide = useWide();
  const blockId = useSession((s) => s.blockId);
  const hasPlan = useSession((s) => Boolean(s.plan));
  const go = [
    blockId && (() => navigate(`/${blockId.startsWith('a_') ? 'area' : 'block'}/${blockId}`)),
    () => navigate('/summary'),
    hasPlan && (() => navigate('/vendors')),
  ];
  return (
    <header data-noprint style={{ position: 'sticky', top: 0, zIndex: 30, background: 'color-mix(in srgb, var(--page) 88%, transparent)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--rule)' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: wide ? '14px 40px' : '10px var(--gutter)', display: 'flex', alignItems: 'center', gap: 16 }}>
        <CircleBtn icon={ArrowLeft} tooltip="Back" onClick={() => navigate(-1)} />
        <div style={{ minWidth: 0 }}>
          <button onClick={() => navigate('/')} style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 650, letterSpacing: '-0.02em' }}>LeafIt</button>
          {title && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)', marginLeft: 10, whiteSpace: 'nowrap' }}>/ {title}</span>}
        </div>
        {wide && (
          <nav aria-label="Steps" style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <ol style={{ listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
              {STEPS.map((name, i) => {
                const done = i < step, now = i === step, can = Boolean(go[i]) && !now;
                return (
                  <li key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {i > 0 && <span aria-hidden="true" style={{ width: 28, height: 1, background: 'var(--rule)' }} />}
                    <button onClick={can ? go[i] : undefined} disabled={!can} aria-current={now ? 'step' : undefined}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, border: `1px solid ${now ? 'var(--accent)' : 'transparent'}`, color: now ? 'var(--accent)' : done ? 'var(--ink)' : 'var(--muted)', fontSize: 13.5, fontWeight: now ? 600 : 500, cursor: can ? 'pointer' : 'default' }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 10.5, background: now ? 'var(--accent)' : done ? 'var(--surface-hi)' : 'transparent', color: now ? 'var(--on-accent)' : 'inherit', border: now || done ? 'none' : '1px solid var(--rule)' }}>
                        {done ? <Check size={12} aria-hidden="true" /> : i + 1}
                      </span>
                      {name}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
        {!wide && <div style={{ flex: 1 }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><CurrencyPicker />{actions}</div>
      </div>
    </header>
  );
}
