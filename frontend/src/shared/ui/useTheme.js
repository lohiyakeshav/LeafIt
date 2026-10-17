import { useCallback, useEffect, useState } from 'react';

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
