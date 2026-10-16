import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Mail } from 'lucide-react';
import { endpoints } from '../../api/endpoints.js';
import { useBlock } from '../../app/useBlock.js';
import { useSession } from '../../app/store.js';
import { Reveal, SectionHead, CircleBtn, IndexRow, Spinner, Kicker } from '../../shared/UI.jsx';
import { BottomSheet } from '../../shared/MetricsBoard.jsx';

const CAT_LABELS = { nursery: 'NURSERY', roofing: 'COOL ROOFS', shade: 'SHADE STRUCTURES' };

function cleanName(name) { return name.replace(' (demo)', ''); }

export default function VendorsPage() {
  const navigate  = useNavigate();
  const blockId = useSession((st) => st.blockId);
  const plan = useSession((st) => st.plan);
  const { block } = useBlock(blockId);
  const planId = plan?.id, bom = plan?.bom;

  const categories = [...new Set((bom ?? []).map(i => i.category))];

  const [vendors, setVendors] = useState(null);
  const [error, setError]     = useState(null);
  const [busy, setBusy]       = useState(null);
  const [quote, setQuote]     = useState(null); // { vendor, q }

  useEffect(() => {
    if (!block) return;
    endpoints.vendors({ block_id: block.id, category: categories.join(',') })
      .then(setVendors)
      .catch(e => setError(e.message));
  }, [block?.id]);

  async function requestQuote(v) {
    setBusy(v.id);
    try {
      const q = await endpoints.quote(planId, v.id);
      setQuote({ vendor: v, q });
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ minHeight: '100dvh' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '10px var(--gutter) 40px' }}>
        <CircleBtn icon={ArrowLeft} tooltip="Back" onClick={() => navigate(-1)} />
        <div style={{ height: 28 }} />

        <SectionHead
          kicker="06 — Make it real"
          title="Who can build it."
          accent="build"
          sub="Local suppliers matched to your bill of materials, nearest and best-rated first."
          size={40}
        />

        <div style={{ height: 22 }} />

        {vendors?.some(v => v.demo) && (
          <Reveal delay={0.2}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--warn)', marginBottom: 12 }}>
              DEMO LISTINGS — REAL ONES WILL COME FROM GOOGLE PLACES
            </p>
          </Reveal>
        )}

        <hr />

        {error && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--warn)', padding: '20px 0' }}>{error}</p>}

        {!vendors && !error && (
          <div style={{ padding: 28, display: 'flex', justifyContent: 'center' }}>
            <Spinner />
          </div>
        )}

        {vendors?.length === 0 && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', padding: '20px 0' }}>No vendors within 15 km</p>
        )}

        {vendors?.map((v, i) => (
          <Reveal key={v.id} delay={0.25 + i * 0.07}>
            <IndexRow
              no={String(i + 1).padStart(2, '0')}
              title={cleanName(v.name)}
              meta={`${CAT_LABELS[v.category] ?? v.category} · ${v.distance_km} KM · ★ ${v.rating}`}
              busy={busy === v.id}
              onTap={busy == null ? () => requestQuote(v) : null}
            />
          </Reveal>
        ))}
      </div>

      {/* Quote sheet */}
      {quote && (
        <BottomSheet onClose={() => setQuote(null)}>
          <div>
            <SectionHead kicker="Quote request" title={cleanName(quote.vendor.name)} size={28} />
            <div style={{ height: 18 }} />
            <Reveal delay={0.15}>
              <div style={{
                padding: 18, background: 'var(--sunk)', borderRadius: 18,
                border: '1px solid var(--rule)',
              }}>
                <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {quote.q.message}
                </pre>
              </div>
            </Reveal>
            <div style={{ height: 18 }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <a
                href={quote.q.whatsapp_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: 1, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  background: 'var(--accent)', borderRadius: 999,
                  fontFamily: 'var(--font-sans)', fontSize: 14.5, fontWeight: 550, color: 'var(--on-accent)',
                  textDecoration: 'none',
                }}
              >
                <MessageCircle size={18} /> WhatsApp
              </a>
              <a
                href={quote.q.mailto_url}
                style={{
                  flex: 1, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  border: '1px solid var(--rule)', borderRadius: 999,
                  fontFamily: 'var(--font-sans)', fontSize: 14.5, fontWeight: 550, color: 'var(--ink)',
                  textDecoration: 'none',
                }}
              >
                <Mail size={18} /> Email
              </a>
            </div>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
