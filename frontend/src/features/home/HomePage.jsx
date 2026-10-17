import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MapPin, Search, SquareDashed, Trees } from 'lucide-react';
import { prefetch } from '../../app/routes.js';
import { delhiTime } from '../../shared/lib/format.js';
import { Reveal, Kicker, AccentText, Pill, Marquee, ThemeToggle, CurrencyPicker } from '../../shared/ui';
import { useWide } from '../../shared/layout/useWide.js';

const STEPS = [
  { icon: Search,       title: 'Find your place',  body: 'Search a neighbourhood or use your location.' },
  { icon: SquareDashed, title: 'Mark the area',    body: 'Drag a box up to 1 km². We read its real heat, land and buildings from satellites.' },
  { icon: Trees,        title: 'Test the fixes',   body: 'Plant trees, coat roofs, shade bus stops on a 3D twin and watch the numbers move.' },
];

export default function HomePage() {
  const [time, setTime] = useState(delhiTime());
  const navigate = useNavigate();

  useEffect(() => {
    prefetch('explore');   // the very next click: have the map page ready
    const tid = setInterval(() => setTime(delhiTime()), 30_000);
    return () => clearInterval(tid);
  }, []);

  const wide = useWide(1000);
  const steps = (
    <ol style={{ listStyle: 'none' }}>
      {STEPS.map(({ icon: Icon, title, body }, i) => (
        <Reveal key={title} delay={0.55 + i * 0.08}>
          <li style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: wide ? '18px 0' : '20px 0', borderTop: '1px solid var(--rule)' }}>
            <span style={{ width: 28, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', paddingTop: 4 }}>{String(i + 1).padStart(2, '0')}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: wide ? 19 : 21, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.15 }}>{title}</div>
              <p style={{ marginTop: 5, fontSize: 14, lineHeight: 1.5, color: 'var(--ink-soft)' }}>{body}</p>
            </div>
            <Icon size={21} color="var(--accent)" aria-hidden="true" style={{ marginTop: 3, flexShrink: 0 }} />
          </li>
        </Reveal>
      ))}
    </ol>
  );

  return (
    // Desktop: exactly one screen (hero left, how-it-works right). Phones: one scrolling column.
    <div style={{ height: wide ? '100dvh' : undefined, minHeight: '100dvh', display: 'flex', flexDirection: 'column', overflow: wide ? 'hidden' : undefined }}>
      <header style={{ padding: wide ? '16px 40px' : '14px var(--gutter)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.02em' }}>LeafIt</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>v0.1 — 2026</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>New Delhi · {time}</span>
        <CurrencyPicker />
        <ThemeToggle />
      </header>

      <main style={{ flex: 1, minHeight: 0, width: '100%', maxWidth: 1240, margin: '0 auto', padding: wide ? '0 40px' : '0 var(--gutter)',
        display: 'grid', gridTemplateColumns: wide ? 'minmax(0, 1.15fr) minmax(340px, 0.85fr)' : '1fr', gap: wide ? 'clamp(40px, 6vw, 96px)' : 0, alignItems: 'center' }}>
        <div style={{ paddingTop: wide ? 0 : 28 }}>
          <Reveal delay={0.35}><Kicker>Heat-action planner — New Delhi</Kicker></Reveal>
          <div style={{ height: wide ? 'clamp(10px, 2vh, 22px)' : 22 }} />
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, delay: 0.15 }}>
            <div role="heading" aria-level={1}><HeroHeadline size={wide ? 'clamp(64px, min(8.5vw, 13vh), 128px)' : 'clamp(54px, 17vw, 104px)'} /></div>
          </motion.div>
          <div style={{ marginTop: 2, marginLeft: 'clamp(0px, calc(100% - 280px), 170px)' }}>
            <Reveal delay={0.8}><HandNote text={'a digital twin of\nyour street'} angle={-0.05} pointBack /></Reveal>
          </div>
          <div style={{ height: wide ? 'clamp(10px, 2vh, 22px)' : 22 }} />
          <Reveal delay={0.55}>
            <p style={{ maxWidth: 480, fontSize: 16, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
              Search any place, mark out your neighbourhood on the satellite map, and test trees, cool roofs and shaded bus stops on a 3D twin of it.
              Gemini plans with you, every number comes from the simulator, and local vendors turn the plan into shade.
            </p>
          </Reveal>
          <div style={{ height: wide ? 'clamp(14px, 3vh, 28px)' : 26 }} />
          <Reveal delay={0.65}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
              <Pill label="Find your place" icon={MapPin} onClick={() => navigate('/explore')} />
              <button onClick={() => navigate('/assumptions')} style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--accent)', padding: '8px 0' }}>METHOD & ASSUMPTIONS →</button>
            </div>
          </Reveal>
        </div>

        <section aria-labelledby="how-h" style={{ paddingTop: wide ? 0 : 52 }}>
          <Reveal delay={0.5}>
            <h2 id="how-h" style={{ fontFamily: 'var(--font-mono)', fontWeight: 400, fontSize: 11.5, letterSpacing: '0.04em', color: 'var(--muted)', marginBottom: 10 }}>HOW IT WORKS</h2>
          </Reveal>
          {steps}
          <div style={{ borderTop: '1px solid var(--rule)' }} />
        </section>
      </main>

      <footer style={{ marginTop: wide ? 0 : 56, borderTop: '1px solid var(--rule)' }}>
        <div style={{ paddingTop: 8 }}><Marquee words={['trees', 'cool roofs', 'shaded stops', 'less heat', 'more shade', 'cleaner air']} size={wide ? 30 : 44} /></div>
        <div style={{ padding: wide ? '6px 40px 14px' : '14px var(--gutter) 24px', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Estimates, not promises</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>28.57° N 77.24° E</span>
        </div>
      </footer>
    </div>
  );
}

// ── HeroHeadline ───────────────────────────────────────────────────────────────
function HeroHeadline({ size }) {
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
      <path d="M4.5 6.7 C40.5 5.6 67.5 19.6 79.2 48.2" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M63 43.7 L80.1 50.4 L86.4 37" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  );
}
