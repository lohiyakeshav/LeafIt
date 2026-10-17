import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Locate, SquareDashed, Trash2, Box, Plus, Minus, Check } from 'lucide-react';
import { endpoints } from '../../api/endpoints.js';
import { prefetch } from '../../app/routes.js';
import { forgetBlock } from '../../api/useBlock.js';
import { AREA } from '../../model/rules.js';
import { AccentText, CircleBtn, Glass, Kicker, Pill, PillToggle, Spinner, ThemeToggle, CurrencyPicker, useTheme } from '../../shared/ui';
import { fetchSatellite } from '../../api/mapTiles.js';
import { boxAround, check, clampToMax, growToMin } from './areaLimits.js';
import { hasKey, loadMaps } from './loadMaps.js';
import { SATELLITE_STYLE, STREET_STYLE, STREET_STYLE_LIGHT } from './mapStyles.js';
import PlaceSearch from './PlaceSearch.jsx';

const DELHI = { lat: 28.5704, lng: 77.2402 };   // where the map starts if location is denied
const OK = '#9EE35F', BAD = '#FF8A5B';
const HINTS = ['Reading satellite surface heat…', 'Finding every building…', 'Checking land cover and live air quality…', 'Building your 3D view…'];
const LAYERS = [{ value: 'satellite', label: 'Satellite' }, { value: 'street', label: 'Map' }];

const toBounds = (b) => ({ north: b.north, south: b.south, east: b.east, west: b.west });

export default function ExplorePage() {
  const navigate = useNavigate();
  const mapEl = useRef(null), drawEl = useRef(null);
  const g = useRef(null), map = useRef(null), overlay = useRef(null), rect = useRef(null), here = useRef(null), drag = useRef(null);
  const touched = useRef(false);               // once the user moves the map, a late GPS fix must not yank it away

  const [phase, setPhase] = useState(hasKey() ? 'loading' : 'nokey');
  const [google, setGoogle] = useState(null);
  const [mapObj, setMapObj] = useState(null);
  const [mode, setMode] = useState('browse');  // browse | draw
  const [layer, setLayer] = useState('satellite');
  const [theme] = useTheme();
  const [info, setInfo] = useState(null);      // check(bounds) of the current box
  const [place, setPlace] = useState(null);    // { name, address } of the searched place
  const [building, setBuilding] = useState(false);
  const [hint, setHint] = useState(0);
  const [error, setError] = useState(null);
  const [locating, setLocating] = useState(false);
  const [wide, setWide] = useState(window.innerWidth >= 900);

  useEffect(() => {
    const on = () => setWide(window.innerWidth >= 900);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  // ── the box ────────────────────────────────────────────────────────────────
  const currentBounds = () => (rect.current ? toBounds(rect.current.getBounds().toJSON()) : null);
  const refreshInfo = useCallback(() => {
    const b = currentBounds();
    if (!b) { setInfo(null); return; }
    const r = check(b);
    const c = r.state === 'ok' ? OK : BAD;
    rect.current.setOptions({ strokeColor: c, fillColor: c });
    setInfo(r);
  }, []);

  const makeRect = useCallback((b, editable) => {
    const { maps } = g.current;
    rect.current?.setMap(null);
    rect.current = new maps.Rectangle({
      map: map.current, bounds: b, strokeColor: OK, strokeWeight: 2, fillColor: OK, fillOpacity: 0.12,
      editable, draggable: editable, clickable: editable,
    });
    if (editable) {
      let raf = 0;
      rect.current.addListener('bounds_changed', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(refreshInfo); });
      rect.current.addListener('mouseup', () => {          // snap back inside the limits when the user lets go
        const cur = currentBounds();
        const fixed = growToMin(clampToMax(cur));
        if (fixed !== cur) rect.current.setBounds(fixed);
      });
    }
    refreshInfo();
  }, [refreshInfo]);

  const clearRect = () => { rect.current?.setMap(null); rect.current = null; setInfo(null); };

  // ── map, location ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasKey()) return undefined;
    let dead = false;
    prefetch('studio');                         // the next page (and three.js) loads while the user picks an area
    loadMaps().then((gg) => {
      if (dead) return;
      g.current = gg;
      const m = new gg.maps.Map(mapEl.current, {
        center: DELHI, zoom: 16, mapTypeId: 'hybrid', styles: SATELLITE_STYLE, tilt: 0,
        disableDefaultUI: true, gestureHandling: 'greedy', clickableIcons: false, backgroundColor: '#0E110F',
      });
      map.current = m;
      const ov = new gg.maps.OverlayView();       // gives us pixel <-> lat/lng for drawing
      ov.onAdd = () => {}; ov.draw = () => {}; ov.onRemove = () => {};
      ov.setMap(m); overlay.current = ov;
      m.addListener('dragstart', () => { touched.current = true; });
      m.addListener('zoom_changed', () => { touched.current = true; });
      setGoogle(gg); setMapObj(m); setPhase('ready');
      locate(true);
    }).catch((e) => { if (!dead) { setPhase('error'); setError(e.message); } });
    return () => { dead = true; rect.current?.setMap(null); here.current?.forEach((s) => s.setMap(null)); };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    map.current.setOptions(layer === 'satellite' ? { mapTypeId: 'hybrid', styles: SATELLITE_STYLE }
      : { mapTypeId: 'roadmap', styles: theme === 'light' ? STREET_STYLE_LIGHT : STREET_STYLE });
  }, [layer, mapObj, theme]);

  useEffect(() => {                             // Esc leaves drawing mode
    if (mode !== 'draw') return undefined;
    const k = (e) => e.key === 'Escape' && setMode('browse');
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [mode]);

  function locate(initial = false) {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocating(false);
      const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!map.current || (initial && touched.current)) return;
      map.current.panTo(c); map.current.setZoom(17);
      const { maps } = g.current;
      here.current?.forEach((s) => s.setMap(null));
      here.current = [
        new maps.Circle({ map: map.current, center: c, radius: Math.max(pos.coords.accuracy, 12), strokeOpacity: 0, fillColor: '#7FD6FF', fillOpacity: 0.16, clickable: false }),
        new maps.Circle({ map: map.current, center: c, radius: 5, strokeColor: '#141815', strokeWeight: 2, fillColor: '#7FD6FF', fillOpacity: 1, clickable: false }),
      ];
    }, () => setLocating(false), { timeout: 8000, maximumAge: 300_000 });
  }

  function onPlace(p) {
    touched.current = true;
    setPlace({ name: p.displayName ?? '', address: p.formattedAddress ?? '' });
    if (p.viewport) map.current.fitBounds(p.viewport); else { map.current.setCenter(p.location); map.current.setZoom(17); }
  }

  // ── drawing: press, drag, release (a plain click drops a neighbourhood-sized box) ───────────────
  const pointOf = (e) => {
    const r = drawEl.current.getBoundingClientRect();
    return overlay.current.getProjection().fromContainerPixelToLatLng(new g.current.maps.Point(e.clientX - r.left, e.clientY - r.top));
  };
  const sketch = (a, b) => ({ north: Math.max(a.lat(), b.lat()), south: Math.min(a.lat(), b.lat()), east: Math.max(a.lng(), b.lng()), west: Math.min(a.lng(), b.lng()) });
  const onDown = (e) => { drawEl.current.setPointerCapture(e.pointerId); drag.current = { a: pointOf(e), moved: false }; };
  const onMove = (e) => {
    if (!drag.current) return;
    const b = sketch(drag.current.a, pointOf(e));
    drag.current.moved = true;
    if (!rect.current || rect.current.getEditable()) makeRect(b, false); else rect.current.setBounds(b);
    refreshInfo();
  };
  const onUp = (e) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    let b = d.moved ? sketch(d.a, pointOf(e)) : boxAround(d.a.lat(), d.a.lng());
    b = growToMin(clampToMax(b));
    makeRect(b, true);
    setMode('browse');
  };

  // ── build ──────────────────────────────────────────────────────────────────
  async function build() {
    const b = currentBounds();
    if (!b || check(b).state !== 'ok') return;
    setError(null); setBuilding(true); setHint(0);
    const tick = setInterval(() => setHint((h) => Math.min(h + 1, HINTS.length - 1)), 2200);
    try {
      fetchSatellite(b).catch(() => {});        // warm the browser's tile cache while the server works
      const { id, cached } = await endpoints.createArea(b, place?.name || 'Selected area');
      if (!cached) forgetBlock(id);             // a fresh build may replace an earlier stand-in that this tab already loaded
      navigate(`/area/${id}`);
    } catch (e) {
      setError(e.message);
      setBuilding(false);
    } finally {
      clearInterval(tick);
    }
  }

  const ok = info?.state === 'ok';
  const step = info ? 3 : place ? 2 : 1;

  if (phase === 'nokey' || phase === 'error') {
    return (
      <div style={{ minHeight: '100dvh', padding: '16px var(--gutter)' }}>
        <CircleBtn icon={ArrowLeft} tooltip="Back" onClick={() => navigate('/')} />
        <div style={{ maxWidth: 520, margin: '12vh auto 0' }}>
          <Kicker color="var(--warn)">{phase === 'nokey' ? 'Map key needed' : 'The map could not load'}</Kicker>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 16, color: 'var(--ink-soft)', lineHeight: 1.6, marginTop: 14 }}>
            {phase === 'nokey'
              ? <>Add your Google Maps key to <code>frontend/.env.local</code> as <code>VITE_GOOGLE_MAPS_API_KEY=…</code> (Maps JavaScript, Places and Map Tiles APIs enabled) and restart the dev server.</>
              : <>Google said: {error}. Check that the Maps JavaScript and Places APIs are enabled for this key and that billing is on.</>}
          </p>
          <div style={{ height: 18 }} />
          <Pill label="Back to home" icon={ArrowLeft} kind="outline" onClick={() => navigate('/')} />
        </div>
      </div>
    );
  }

  const actions = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {error && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--warn)', lineHeight: 1.5 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Pill label={mode === 'draw' ? 'Cancel' : info ? 'Redraw' : 'Mark area'} icon={SquareDashed} kind="outline" onClick={() => setMode(mode === 'draw' ? 'browse' : 'draw')} />
        {info && <CircleBtn icon={Trash2} tooltip="Clear the box" onClick={clearRect} />}
        <div style={{ flex: 1 }}><Pill label="Build 3D view" icon={Box} expand disabled={!ok || building} onClick={ok ? build : undefined} /></div>
      </div>
    </div>
  );

  // ── panel (side on desktop, below the map on phones) ────────────────────────
  const panel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, height: '100%' }}>
      {wide && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <CircleBtn icon={ArrowLeft} tooltip="Back" onClick={() => navigate('/')} />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 650, letterSpacing: '-0.02em' }}>LeafIt</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>/ new area</span>
          <div style={{ flex: 1 }} />
          <CurrencyPicker />
          <ThemeToggle />
        </div>
      )}
      <div>
        <Kicker>Heat-action planner</Kicker>
        <div style={{ height: 12 }} />
        <AccentText text="Where should we cool?" accent="cool" style={{ fontFamily: 'var(--font-serif)', fontSize: wide ? 40 : 34, lineHeight: 1, letterSpacing: '-0.02em' }} />
        <p style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.55, marginTop: 10 }}>
          Find your neighbourhood, mark the blocks you care about, and we&rsquo;ll build a 3D twin from real satellite heat and buildings.
        </p>
      </div>

      {wide && <PlaceSearch google={google} map={mapObj} onPick={onPlace} />}

      <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid var(--rule)' }}>
        <StepRow n={1} state={step > 1 ? 'done' : 'now'} title="Find the place" detail={place ? place.name : 'Search, or use your location'} />
        <StepRow n={2} state={step > 2 ? 'done' : step === 2 ? 'now' : 'next'} title="Mark the area" detail={`Drag a box · ${AREA.min_side_m} m to ${AREA.max_km2} km²`} />
        <StepRow n={3} state={step === 3 ? 'now' : 'next'} title="Build the 3D view" detail="Heat, buildings and land cover from satellites" />
      </ol>

      <AreaCard info={info} />

      <div style={{ flex: 1 }} />
      {wide && actions}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
        Imagery © Google · surface heat from Landsat 8/9 · buildings from Google Open Buildings
      </span>
    </div>
  );

  const mapCard = (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--rule)', background: 'var(--sunk)' }}>
      <div ref={mapEl} style={{ position: 'absolute', inset: 0 }} />
      {/* soft inner edge so the map sits inside the UI instead of being pasted on it */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03), inset 0 0 60px rgba(14,17,15,0.55)', borderRadius: 'var(--radius)', zIndex: 4 }} />
      {phase === 'loading' && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}><Spinner /></div>}
      {mode === 'draw' && (
        <div ref={drawEl} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
          style={{ position: 'absolute', inset: 0, zIndex: 6, cursor: 'crosshair', touchAction: 'none' }} />
      )}
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 7 }}>
        <Glass radius={999} padding="3px"><PillToggle options={LAYERS} value={layer} onChange={setLayer} dense bare /></Glass>
      </div>
      <AnimatePresence>
        {mode === 'draw' && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 7, pointerEvents: 'none' }}>
            <Glass radius={999} padding="9px 16px">
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink)', whiteSpace: 'nowrap' }}>Drag to mark your area · click for a 600 m box · Esc to cancel</span>
            </Glass>
          </motion.div>
        )}
      </AnimatePresence>
      <div style={{ position: 'absolute', right: 12, bottom: 28, zIndex: 7, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Glass radius={22} padding="3px" style={{ display: 'flex', flexDirection: 'column' }}>
          <CircleBtn icon={Plus} tooltip="Zoom in" onClick={() => map.current?.setZoom(map.current.getZoom() + 1)} />
          <CircleBtn icon={Minus} tooltip="Zoom out" onClick={() => map.current?.setZoom(map.current.getZoom() - 1)} />
        </Glass>
        <Glass radius={999} padding="3px"><CircleBtn icon={Locate} tooltip="Go to my location" onClick={() => locate(false)} disabled={locating} /></Glass>
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: wide ? 'row' : 'column', background: 'var(--page)' }}>
      {wide ? (
        <>
          <aside style={{ width: 380, flexShrink: 0, padding: '22px 24px', overflowY: 'auto' }}>{panel}</aside>
          <div style={{ flex: 1, display: 'flex', padding: '12px 12px 12px 0' }}>{mapCard}</div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px 8px', position: 'relative', zIndex: 20 }}>
            <CircleBtn icon={ArrowLeft} tooltip="Back" onClick={() => navigate('/')} />
            <div style={{ flex: 1 }}><PlaceSearch google={google} map={mapObj} onPick={onPlace} /></div>
            <ThemeToggle />
          </div>
          <div style={{ height: '52dvh', display: 'flex', padding: '0 12px' }}>{mapCard}</div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '18px var(--gutter) 20px' }}>{panel}</div>
          {/* on phones the next action is always in reach, not below the fold */}
          <div style={{ padding: '10px 12px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', borderTop: '1px solid var(--rule)', background: 'var(--page)' }}>{actions}</div>
        </>
      )}

      <AnimatePresence>
        {building && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'var(--glass)', backdropFilter: 'blur(6px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
            <Spinner />
            <AnimatePresence mode="wait">
              <motion.span key={hint} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                style={{ fontFamily: 'var(--font-hand)', fontSize: 26, color: 'var(--accent)' }}>{HINTS[hint]}</motion.span>
            </AnimatePresence>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>A new area takes about ten seconds; opening it again is instant.</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepRow({ n, state, title, detail }) {
  const color = state === 'next' ? 'var(--muted)' : 'var(--ink)';
  return (
    <li style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '13px 0', borderBottom: '1px solid var(--rule)', opacity: state === 'next' ? 0.6 : 1 }}>
      <span style={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 11,
        background: state === 'done' ? 'var(--accent)' : 'transparent', color: state === 'done' ? 'var(--on-accent)' : state === 'now' ? 'var(--accent)' : 'var(--muted)',
        border: state === 'done' ? 'none' : `1px solid ${state === 'now' ? 'var(--accent)' : 'var(--rule)'}`,
      }}>{state === 'done' ? <Check size={14} /> : `0${n}`}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 550, color }}>{title}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>
      </div>
    </li>
  );
}

/** The drawn area at a glance: its size against the limit, so "too large" is visible before anyone presses Build. */
function AreaCard({ info }) {
  if (!info) return null;
  const ok = info.state === 'ok';
  const pct = Math.min(1, info.km2 / AREA.max_km2);
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      style={{ padding: 16, borderRadius: 18, background: 'var(--surface)', border: `1px solid ${ok ? 'var(--rule)' : 'color-mix(in srgb, var(--warn) 50%, transparent)'}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted)' }}>SELECTED AREA</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: ok ? 'var(--accent)' : 'var(--warn)' }}>{ok ? 'READY' : info.state === 'small' ? 'TOO SMALL' : 'TOO LARGE'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
        <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.03em' }}>{info.km2.toFixed(2)}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>km² · {Math.round(info.w)} × {Math.round(info.h)} m</span>
      </div>
      <div style={{ height: 4, background: 'var(--rule)', borderRadius: 2, marginTop: 12, overflow: 'hidden' }}>
        <motion.div animate={{ width: `${pct * 100}%` }} style={{ height: '100%', background: ok ? 'var(--accent)' : 'var(--warn)', borderRadius: 2 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--muted)', marginTop: 6 }}>
        <span>0</span><span>{AREA.max_km2} km² max</span>
      </div>
      {!ok && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--warn)', marginTop: 10 }}>{info.message.split(' · ').slice(1).join(' · ')}</div>}
    </motion.div>
  );
}
