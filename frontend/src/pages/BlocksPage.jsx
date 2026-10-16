import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Camera } from 'lucide-react';
import { api } from '../api/client.js';
import { delhiTime } from '../utils/format.js';
import { parseBlock } from '../utils/heatGrid.js';
import { Reveal, Kicker, AccentText, Pill, IndexRow, Marquee, Spinner } from '../components/UI.jsx';

export default function BlocksPage() {
  const [blocks, setBlocks] = useState(null);
  const [error, setError] = useState(null);
  const [opening, setOpening] = useState(null);
  const [time, setTime] = useState(delhiTime());
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/blocks')
      .then(setBlocks)
      .catch(e => setError(e.message));
    const tid = setInterval(() => setTime(delhiTime()), 30_000);
    return () => clearInterval(tid);
  }, []);

  async function openBlock(id) {
    setOpening(id);
    try {
      const raw = await api.get(`/blocks/${id}`);
      const block = parseBlock(raw);
      navigate(`/simulator/${id}`, { state: { block } });
    } catch (e) {
      alert(e.message);
    } finally {
      setOpening(null);
    }
  }

  function retry() {
    setError(null);
    setBlocks(null);
    api.get('/blocks').then(setBlocks).catch(e => setError(e.message));
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* Masthead */}
      <div style={{ padding: '14px var(--gutter) 0' }}>
        <Reveal>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 650, letterSpacing: '-0.02em' }}>LeafIt</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>v0.1 — 2026</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>New Delhi · {time}</span>
          </div>
        </Reveal>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 720, padding: '0 var(--gutter)' }}>
          <div style={{ height: 'clamp(48px, 8vw, 88px)' }} />

          <Reveal delay={0.45}>
            <Kicker>Heat-action planner — New Delhi</Kicker>
          </Reveal>
          <div style={{ height: 22 }} />

          {/* Hero headline */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.15 }}
          >
            <HeroHeadline />
          </motion.div>

          {/* Handnote */}
          <div style={{ marginTop: 2, marginLeft: 'clamp(0px, calc(100% - 280px), 150px)' }}>
            <Reveal delay={0.9}>
              <HandNote text={'a digital twin of\nyour street'} angle={-0.05} pointBack />
            </Reveal>
          </div>

          <div style={{ height: 22 }} />

          {/* Body copy */}
          <Reveal delay={0.65}>
            <div style={{ maxWidth: 460 }}>
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 16, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
                Test trees, cool roofs and shaded bus stops on a satellite twin of your neighbourhood.
                Gemini plans with you, every number comes from the simulator, and local vendors turn the plan into shade.
              </p>
            </div>
          </Reveal>

          <div style={{ height: 26 }} />

          {/* Photo audit CTA */}
          <Reveal delay={0.75}>
            <Pill
              label="Audit a street from a photo"
              icon={Camera}
              kind="outline"
              onClick={() => navigate('/photo-audit')}
            />
          </Reveal>

          <div style={{ height: 56 }} />

          {/* Block list */}
          <Reveal delay={0.85}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)' }}>01 — Choose a block</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <button
                  onClick={() => navigate('/assumptions')}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', cursor: 'pointer' }}
                >
                  METHOD & ASSUMPTIONS →
                </button>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)' }}>10 m grid</span>
              </div>
            </div>
          </Reveal>
          <div style={{ height: 10 }} />
          <hr />

          {error && (
            <div style={{ padding: '22px 0' }}>
              <Kicker color="var(--warn)">Can't reach the LeafIt server</Kicker>
              <div style={{ height: 10 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)' }}>{error}</span>
              <div style={{ height: 16 }} />
              <Pill label="Try again" onClick={retry} kind="outline" dense />
            </div>
          )}

          {!blocks && !error && (
            <div style={{ padding: 28, display: 'flex', justifyContent: 'center' }}>
              <Spinner />
            </div>
          )}

          {blocks && blocks.map((b, i) => (
            <Reveal key={b.id} delay={0.95 + i * 0.07}>
              <IndexRow
                no={String(i + 1).padStart(2, '0')}
                title={b.name.replace(' (synthetic demo)', '')}
                meta={b.synthetic ? 'SYNTHETIC DEMO DATA · 600 × 600 m' : 'SATELLITE DATA'}
                busy={opening === b.id}
                onTap={opening == null ? () => openBlock(b.id) : null}
              />
            </Reveal>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 64 }}>
        <hr />
        <div style={{ height: 10 }} />
        <Marquee words={['trees', 'cool roofs', 'shaded stops', 'less heat', 'more shade', 'cleaner air']} />
        <div style={{ padding: '14px var(--gutter) 24px', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Estimates, not promises</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>28.57° N 77.24° E</span>
        </div>
      </div>
    </div>
  );
}

// ── HeroHeadline ───────────────────────────────────────────────────────────────
function HeroHeadline() {
  const size = 'clamp(54px, 17vw, 104px)';
  return (
    <div>
      <HeroLine delay={0}>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: size, fontWeight: 600, lineHeight: 0.92, letterSpacing: '-0.055em' }}>
          Cool the
        </span>
      </HeroLine>
      <HeroLine delay={0.12}>
        <AccentText
          text="block."
          accent="block"
          style={{ fontFamily: 'var(--font-sans)', fontSize: size, fontWeight: 600, lineHeight: 0.92, letterSpacing: '-0.055em' }}
        />
      </HeroLine>
    </div>
  );
}

function HeroLine({ children, delay }) {
  return (
    <div style={{ overflow: 'hidden' }}>
      <motion.div
        initial={{ y: '110%' }}
        animate={{ y: 0 }}
        transition={{ duration: 1.1, delay, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </div>
  );
}

// ── HandNote ───────────────────────────────────────────────────────────────────
function HandNote({ text, angle = -0.07, pointBack = false }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: pointBack ? 'flex-start' : 'flex-end', gap: 6, transform: `rotate(${angle}rad)` }}>
      {pointBack && (
        <svg width={64} height={44} viewBox="0 0 90 56" fill="none" style={{ transform: 'scaleX(-1)' }}>
          <DrawnArrowSVG />
        </svg>
      )}
      <span style={{ fontFamily: 'var(--font-hand)', fontSize: 22, color: 'var(--accent)', lineHeight: 1.05, whiteSpace: 'pre' }}>
        {text}
      </span>
      {!pointBack && (
        <svg width={90} height={56} viewBox="0 0 90 56" fill="none">
          <DrawnArrowSVG />
        </svg>
      )}
    </div>
  );
}

function DrawnArrowSVG() {
  return (
    <>
      <path d="M4.5 6.7 C40.5 5.6 67.5 19.6 79.2 48.2" stroke="#9EE35F" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M63 43.7 L80.1 50.4 L86.4 37" stroke="#9EE35F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  );
}
