import { useEffect, useRef, useState } from 'react';

export function AnimatedNumber({ value, format, style = {} }) {
  const [displayed, setDisplayed] = useState(value);
  const shown = useRef(value);           // what is on screen now: a new value animates from here, even mid-animation
  const rafRef = useRef();
  const startTime = useRef();

  useEffect(() => {
    startTime.current = performance.now();
    const from = shown.current;
    const to = value;
    const duration = 650;

    function tick(now) {
      const t = Math.min(1, (now - startTime.current) / duration);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      shown.current = from + (to - from) * ease;
      setDisplayed(shown.current);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <span style={style}>{format(displayed)}</span>;
}
