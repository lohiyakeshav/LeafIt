import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Phone, Globe, MapPin, Star, Sprout, House, Bus } from 'lucide-react';
import { endpoints } from '../../api/endpoints.js';
import { useBlock } from '../../api/useBlock.js';
import { useSession } from '../../state/session.js';
import { SPECIES_BY_ID } from '../../model/rules.js';
import { Reveal, SectionHead, Spinner, Pill, ThemeToggle, useToast, Dialog } from '../../shared/ui';
import AppBar from '../../shared/layout/AppBar.jsx';
import { useWide } from '../../shared/layout/useWide.js';

const CATS = {
  nursery: { label: 'Nurseries', tag: 'NURSERY', icon: Sprout },
  roofing: { label: 'Cool roofs', tag: 'COOL ROOFS', icon: House },
  shade: { label: 'Shade structures', tag: 'SHADE', icon: Bus },
};
const SORTS = [{ value: 'near', label: 'Nearest' }, { value: 'rating', label: 'Best rated' }];
const RADIUS_KM = 25;   // the backend's search radius (market.SEARCH_RADIUS_KM)

export default function VendorsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const wide = useWide();
  const blockId = useSession((st) => st.blockId);
  const plan = useSession((st) => st.plan);
  const { block } = useBlock(blockId);
  const planId = plan?.id, bom = plan?.bom;
  const categories = useMemo(() => [...new Set((bom ?? []).map((i) => i.category))], [bom]);

  const [vendors, setVendors] = useState(null);
  const [searchable, setSearchable] = useState(true);   // false: the server has no Places key, so there is no vendor search
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [quote, setQuote] = useState(null); // { vendor, q }
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('near');

  useEffect(() => {
    if (!block || !categories.length) return;
    endpoints.vendors({ block_id: block.id, category: categories.join(',') })
      .then((r) => { setVendors(r.vendors); setSearchable(r.available); })
      .catch((e) => setError(e.message));
  }, [block, categories]);

  async function requestQuote(v) {
    setBusy(v.id);
    try {
      setQuote({ vendor: v, q: await endpoints.quote(planId, v.id) });
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(() => (vendors ?? []).reduce((a, v) => ({ ...a, [v.category]: (a[v.category] ?? 0) + 1 }), {}), [vendors]);
  const shown = useMemo(() => (vendors ?? [])
    .filter((v) => cat === 'all' || v.category === cat)
    .sort((a, b) => (sort === 'near' ? a.distance_km - b.distance_km : (b.rating ?? 0) - (a.rating ?? 0))), [vendors, cat, sort]);

  if (!planId) return (
    <div style={{ minHeight: '100dvh' }}>
      <AppBar step={2} actions={<ThemeToggle />} />
      <div style={{ maxWidth: 560, margin: '14vh auto 0', padding: '0 var(--gutter)', textAlign: 'center' }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em' }}>Save a plan first</h1>
        <p style={{ marginTop: 10, color: 'var(--ink-soft)' }}>Vendors are matched to your plan&rsquo;s bill of materials.</p>
        <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center' }}><Pill label="Review the plan" onClick={() => navigate('/summary')} /></div>
      </div>
    </div>
  );

  const filterBtn = (value, label, n, Icon) => {
    const on = cat === value;
    return (
      <button key={value} onClick={() => setCat(value)} aria-pressed={on}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: wide ? '10px 12px' : '8px 14px', borderRadius: wide ? 12 : 999, border: `1px solid ${on ? 'var(--accent)' : wide ? 'transparent' : 'var(--rule)'}`, background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent)' : 'var(--ink)', fontSize: 14, fontWeight: on ? 600 : 500, whiteSpace: 'nowrap', textAlign: 'left' }}>
        {Icon && <Icon size={16} aria-hidden="true" />}
        <span style={{ flex: 1 }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)' }}>{n}</span>
      </button>
    );
  };
  const filters = (
    <>
      {filterBtn('all', 'All', vendors?.length ?? 0)}
      {categories.map((c) => filterBtn(c, CATS[c]?.label ?? c, counts[c] ?? 0, CATS[c]?.icon))}
    </>
  );

  return (
    <div style={{ minHeight: '100dvh' }}>
      <AppBar step={2} title={block?.name} actions={<ThemeToggle />} />
      <main style={{ maxWidth: 1320, margin: '0 auto', padding: wide ? '0 40px' : '0 var(--gutter)' }}>
        <div style={{ padding: wide ? '40px 0 28px' : '24px 0 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
          <SectionHead kicker="06 — Make it real" title="Who can build it." accent="build"
            sub={`Real businesses within ${RADIUS_KM} km of your area, from Google Maps, matched to your bill of materials. Request a quote and the message is written for you, ready for WhatsApp or a call.`} size={wide ? 44 : 34} />
          {bom && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {bom.map((it) => (
                <div key={`${it.type}:${it.species ?? ''}`} style={{ padding: '10px 14px', border: '1px solid var(--rule)', borderRadius: 14 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted)' }}>{it.species && SPECIES_BY_ID[it.species] ? SPECIES_BY_ID[it.species].common.toUpperCase() : CATS[it.category]?.tag ?? it.category}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{it.quantity} {it.unit}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Categories with nobody inside the radius: say how far the nearest one is */}
        {categories.filter((c) => vendors?.some((v) => v.category === c) && vendors.filter((v) => v.category === c).every((v) => v.beyond_radius)).map((c) => {
          const nearest = Math.min(...vendors.filter((v) => v.category === c).map((v) => v.distance_km));
          return (
            <p key={c} role="status" style={{ fontSize: 14, padding: '12px 16px', border: '1px solid var(--rule)', borderRadius: 12, marginBottom: 12, background: 'var(--surface)' }}>
              No {(CATS[c]?.label ?? c).toLowerCase()} within {RADIUS_KM} km of this area. The nearest is <strong>{nearest} km</strong> away; we&rsquo;ve listed the closest ones below.
            </p>
          );
        })}

        {!searchable && (
          <p role="note" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--warn)', padding: '10px 14px', border: '1px solid color-mix(in srgb, var(--warn) 40%, transparent)', borderRadius: 12, marginBottom: 20 }}>
            VENDOR SEARCH IS OFF: this server has no Google Maps server key, so no suppliers can be looked up.
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: wide ? '240px minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: wide ? 40 : 16, alignItems: 'start' }}>
          {/* Filters: a sidebar on desktop, a scrolling chip row on phones */}
          <aside aria-label="Filter vendors" style={{ position: wide ? 'sticky' : 'static', top: 96 }}>
            {wide && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em', color: 'var(--muted)', marginBottom: 8 }}>CATEGORY</div>}
            <div role="group" style={{ display: 'flex', flexDirection: wide ? 'column' : 'row', gap: wide ? 2 : 8, overflowX: wide ? 'visible' : 'auto', scrollbarWidth: 'none', paddingBottom: wide ? 0 : 4 }}>{filters}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em', color: 'var(--muted)', margin: wide ? '24px 0 8px' : '12px 0 8px' }}>SORT</div>
            <div role="group" style={{ display: 'flex', gap: 8 }}>
              {SORTS.map((s) => (
                <button key={s.value} onClick={() => setSort(s.value)} aria-pressed={sort === s.value}
                  style={{ padding: '7px 14px', borderRadius: 999, border: `1px solid ${sort === s.value ? 'var(--accent)' : 'var(--rule)'}`, color: sort === s.value ? 'var(--accent)' : 'var(--ink)', fontSize: 13 }}>
                  {s.label}
                </button>
              ))}
            </div>
          </aside>

          <section aria-label="Vendors">
            {error && <p role="alert" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--warn)' }}>{error}</p>}
            {!vendors && !error && <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><Spinner /></div>}
            {searchable && vendors?.length === 0 && <p style={{ color: 'var(--muted)' }}>Google Maps found no suppliers for these items near this area.</p>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {shown.map((v, i) => {
                const C = CATS[v.category];
                return (
                  <Reveal key={v.id} delay={Math.min(i, 8) * 0.04}>
                    <article style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, padding: 22, background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--radius)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.04em', color: 'var(--accent)' }}>
                        {C?.icon && <C.icon size={14} aria-hidden="true" />}{C?.tag ?? v.category}
                      </div>
                      <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.2 }}>{v.name}</h2>
                      {v.services && <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{v.services}</p>}
                      {v.address && <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.45 }}>{v.address}</p>}
                      <div style={{ display: 'flex', gap: 16, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', marginTop: 'auto' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: v.beyond_radius ? 'var(--warn)' : undefined }}><MapPin size={13} aria-hidden="true" />{v.distance_km} km{v.beyond_radius ? ` · beyond ${RADIUS_KM} km` : ''}</span>
                        {v.rating != null
                          ? <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Star size={13} aria-hidden="true" />{v.rating.toFixed(1)}<span className="sr-only"> out of 5</span>{v.ratings_count ? ` (${v.ratings_count})` : ''}</span>
                          : <span>no ratings yet</span>}
                      </div>
                      <Pill label="Request a quote" kind="outline" dense expand loading={busy === v.id} onClick={() => requestQuote(v)} />
                    </article>
                  </Reveal>
                );
              })}
            </div>
          </section>
        </div>
        <div style={{ height: 72 }} />
      </main>

      {quote && (
        <Dialog onClose={() => setQuote(null)} width={600}>
          <SectionHead kicker="Quote request" title={quote.vendor.name} size={28} />
          <pre style={{ marginTop: 18, padding: 18, background: 'var(--sunk)', border: '1px solid var(--rule)', borderRadius: 18, fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {quote.q.message}
          </pre>
          <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a href={quote.q.whatsapp_url} target="_blank" rel="noopener noreferrer"
              style={{ flex: 1, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--accent)', borderRadius: 999, fontSize: 14.5, fontWeight: 550, color: 'var(--on-accent)' }}>
              <MessageCircle size={18} aria-hidden="true" /> WhatsApp
            </a>
            {quote.q.tel_url && (
              <a href={quote.q.tel_url} style={{ flex: 1, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px solid var(--rule)', borderRadius: 999, fontSize: 14.5, fontWeight: 550, color: 'var(--ink)' }}>
                <Phone size={18} aria-hidden="true" /> Call
              </a>
            )}
            {quote.q.website && (
              <a href={quote.q.website} target="_blank" rel="noopener noreferrer" style={{ flex: 1, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px solid var(--rule)', borderRadius: 999, fontSize: 14.5, fontWeight: 550, color: 'var(--ink)' }}>
                <Globe size={18} aria-hidden="true" /> Website
              </a>
            )}
            {quote.q.maps_url && (
              <a href={quote.q.maps_url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px solid var(--rule)', borderRadius: 999, fontSize: 14.5, fontWeight: 550, color: 'var(--ink)' }}>
                <MapPin size={18} aria-hidden="true" /> Google Maps
              </a>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
