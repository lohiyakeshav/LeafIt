import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MapPin, Search, X } from 'lucide-react';
import { Spinner } from '../../shared/ui';

/**
 * LeafIt-styled place search on top of Places API (New) autocomplete data (Google's drop-in widget can't be themed).
 * One session token per search, so typing + picking is billed as a single autocomplete session.
 */
export default function PlaceSearch({ google, map, onPick, autoFocus = false }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const token = useRef(null);
  const seq = useRef(0);
  const input = useRef(null);

  useEffect(() => {
    const q = text.trim();
    if (!google || q.length < 2) return undefined;   // too short: `shown` below is empty, nothing to fetch
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        setBusy(true);
        const { AutocompleteSuggestion, AutocompleteSessionToken } = await google.maps.importLibrary('places');
        token.current ??= new AutocompleteSessionToken();
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q, sessionToken: token.current, ...(map ? { locationBias: map.getCenter() } : {}),
        });
        if (id !== seq.current) return;               // a newer keystroke already asked again
        setItems(suggestions.filter((s) => s.placePrediction).slice(0, 6));
        setActive(0);
        setOpen(true);
      } catch {
        if (id === seq.current) setItems([]);
      } finally {
        if (id === seq.current) setBusy(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [text, google, map]);

  const shown = text.trim().length >= 2 ? items : [];   // stale suggestions disappear as soon as the query is too short

  async function pick(s) {
    const p = s.placePrediction;
    setText(p.mainText?.text ?? p.text.text);
    setOpen(false);
    const place = p.toPlace();
    await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location', 'viewport'] });
    token.current = null;                            // the session ends with a pick
    onPick?.(place);
    input.current?.blur();
  }

  function onKey(e) {
    if (!open || !shown.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % shown.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + shown.length) % shown.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, height: 50, padding: '0 14px 0 16px',
        background: 'var(--sunk)', border: `1px solid ${open ? 'rgba(158,227,95,0.45)' : 'var(--rule)'}`, borderRadius: 16,
        transition: 'border-color 0.2s',
      }}>
        <Search size={17} color="var(--muted)" />
        <input
          ref={input} value={text} autoFocus={autoFocus} placeholder="Search a neighbourhood, street or landmark"
          onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          onFocus={() => shown.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          aria-label="Search for a place" aria-expanded={open} role="combobox"
          style={{ flex: 1, minWidth: 0, height: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 14.5, color: 'var(--ink)' }}
        />
        {busy ? <Spinner size={15} /> : text && (
          <button onClick={() => { setText(''); setItems([]); input.current?.focus(); }} aria-label="Clear search" style={{ display: 'flex', color: 'var(--muted)' }}><X size={16} /></button>
        )}
      </div>
      <AnimatePresence>
        {open && shown.length > 0 && (
          <motion.ul
            role="listbox" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}
            style={{
              position: 'absolute', top: 56, left: 0, right: 0, zIndex: 30, listStyle: 'none', padding: 6,
              background: 'rgba(27,32,28,0.97)', backdropFilter: 'blur(14px)', border: '1px solid var(--rule)', borderRadius: 16,
              boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
            }}
          >
            {shown.map((s, i) => {
              const p = s.placePrediction;
              return (
                <li key={p.placeId} role="option" aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setActive(i)}
                  style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', borderRadius: 11, cursor: 'pointer', background: i === active ? 'var(--surface-hi)' : 'transparent' }}>
                  <MapPin size={16} color={i === active ? 'var(--accent)' : 'var(--muted)'} style={{ flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.mainText?.text ?? p.text.text}</div>
                    {p.secondaryText?.text && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.secondaryText.text}</div>}
                  </div>
                </li>
              );
            })}
            <li aria-hidden style={{ padding: '6px 12px 2px', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--muted)', textAlign: 'right' }}>Powered by Google</li>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
