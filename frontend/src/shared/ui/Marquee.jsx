import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Words scrolling sideways forever. Repeats the list as often as the screen needs, so even an ultrawide one is never half empty. */
export function Marquee({ words = [], size = 44, seconds = 38 }) {
  const box = useRef();
  const ref = useRef();
  const xRef = useRef(0);
  const rafRef = useRef();
  const [reps, setReps] = useState(2);   // copies of the word list: the box's width plus one spare copy to scroll into
  const repsRef = useRef(reps);   // what the animation loop and the measuring read (they live outside render)
  useLayoutEffect(() => { repsRef.current = reps; }, [reps]);   // before the browser measures the new copies

  useEffect(() => {
    const fit = () => {
      const one = ref.current.scrollWidth / repsRef.current;
      if (one > 0) setReps(Math.max(2, Math.ceil(box.current.clientWidth / one) + 1));
    };
    fit();
    const ro = new ResizeObserver(fit);   // window resizes, and the web font arriving (it changes the word widths)
    ro.observe(box.current);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let last = performance.now();
    function tick(now) {
      const dt = now - last; last = now;
      const el = ref.current;
      if (!el) return;
      const one = el.scrollWidth / repsRef.current;   // scroll exactly one copy, then wrap: the seam never shows
      xRef.current -= (dt / 1000) * (one / seconds);
      if (xRef.current <= -one) xRef.current += one;
      el.style.transform = `translateX(${xRef.current}px)`;
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [seconds]);

  return (
    <div ref={box} style={{ overflow: 'hidden', userSelect: 'none', height: size * 1.2 }}>
      <div
        ref={ref}
        style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', willChange: 'transform' }}
      >
        {Array.from({ length: reps }, (_, rep) =>
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
