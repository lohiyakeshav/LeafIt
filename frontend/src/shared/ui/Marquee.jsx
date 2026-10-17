import { useEffect, useRef } from 'react';

export function Marquee({ words = [], size = 44, seconds = 38 }) {
  const ref = useRef();
  const xRef = useRef(0);
  const rafRef = useRef();


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
