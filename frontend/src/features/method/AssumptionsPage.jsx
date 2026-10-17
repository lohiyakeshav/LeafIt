import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { endpoints } from '../../api/endpoints.js';
import { Reveal, SectionHead, CircleBtn, Spinner, Kicker } from '../../shared/ui';

const STATUS_COLOR = {
  cited: 'var(--accent)',
  derived: 'var(--accent)',
  estimate: 'var(--ink)',
  'modelling choice': 'var(--muted)',
  'under review': 'var(--warn)',
};

export default function AssumptionsPage() {
  const navigate = useNavigate();
  const [assumptions, setAssumptions] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    endpoints.assumptions()
      .then(data => {
        setAssumptions(data);
        setLoading(false);
      })
      .catch(e => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ minHeight: '100dvh', padding: '10px var(--gutter) 48px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <CircleBtn icon={ArrowLeft} tooltip="Back" onClick={() => navigate(-1)} />
        <div style={{ height: 28 }} />

        <SectionHead
          kicker="Method"
          title="How we calculate this."
          accent="calculate"
          sub="A fast grid model, not a physics simulation. Each 10 m cell starts from its satellite surface temperature; every item cools its own cell and, more weakly, its neighbours. Gemini only picks and explains plans. Every figure comes from this model, and every number below has a source."
          size={38}
        />

        <div style={{ height: 18 }} />

        <Reveal delay={0.2}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            {[
              ['CITED', 'a source gives the value'],
              ['DERIVED', 'computed from cited figures'],
              ['ESTIMATE', 'inside a cited range'],
            ].map(([k, d]) => (
              <span key={k} style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted)' }}>
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{k}</span> · {d}
              </span>
            ))}
          </div>
        </Reveal>

        <div style={{ height: 18 }} />
        <hr />

        {loading && (
          <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
            <Spinner />
          </div>
        )}

        {error && (
          <div style={{ padding: '24px 0' }}>
            <Kicker color="var(--warn)">Failed to load assumptions</Kicker>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--warn)', marginTop: 8 }}>{error}</p>
          </div>
        )}

        {assumptions && Array.isArray(assumptions) && (
          <div style={{ marginTop: 8 }}>
            {assumptions.filter(a => a.key).length > 0 && (
              <div style={{ margin: '14px 0 4px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--warn)' }}>
                THE THREE ASSUMPTIONS MOST WORTH CHALLENGING
              </div>
            )}
            {assumptions.filter(a => a.key).map((a, i) => (
              <Reveal key={a.item} delay={0.1 + i * 0.04}>
                <AssumptionItem item={a} />
              </Reveal>
            ))}
            <button
              onClick={() => setShowAll(o => !o)}
              style={{ margin: '18px 0 4px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}
            >
              {showAll ? 'HIDE' : 'SHOW'} ALL OTHER ASSUMPTIONS ({assumptions.filter(a => !a.key).length})
            </button>
            {showAll && assumptions.filter(a => !a.key).map((a, i) => (
              <AssumptionItem key={a.item || i} item={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssumptionItem({ item: a }) {
  const status = (a.status || '').toLowerCase();
  const color = STATUS_COLOR[status] || 'var(--muted)';
  const why = a.why || '';
  const sources = a.sources || [];

  return (
    <div style={{
      padding: '20px 0',
      borderBottom: '1px solid var(--rule)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          margin: 0,
        }}>
          {a.item}
        </h3>
        <span style={{
          padding: '4px 9px',
          borderRadius: 999,
          border: `1px solid ${color === 'var(--muted)' ? 'var(--rule)' : color}`,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          {status}
        </span>
      </div>

      <div style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 15,
        color: 'var(--ink)',
        lineHeight: 1.5,
      }}>
        {a.value}
      </div>

      {why && (
        <p style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 13.5,
          color: 'var(--ink-soft)',
          lineHeight: 1.55,
          margin: '2px 0 0',
        }}>
          {why}
        </p>
      )}

      {sources.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {sources.map((s, idx) => (
            <a
              key={idx}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--accent)',
                textDecoration: 'none',
                width: 'fit-content',
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <ArrowUpRight size={13} style={{ flexShrink: 0 }} />
              <span>{s.title}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
