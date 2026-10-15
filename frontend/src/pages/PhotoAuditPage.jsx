import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Camera, Image as ImageIcon, Trees, House, Bus, ArrowRight } from 'lucide-react';
import { api } from '../api/client.js';
import { Reveal, SectionHead, CircleBtn, Pill, Kicker } from '../components/UI.jsx';

const TOOL_ICONS = {
  tree: Trees,
  cool_roof: House,
  shade_stop: Bus,
};

const TOOL_LABELS = {
  tree: 'Tree',
  cool_roof: 'Cool roof',
  shade_stop: 'Shaded stop',
};

export default function PhotoAuditPage() {
  const navigate = useNavigate();
  const [imagePreview, setImagePreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    setResult(null);

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setImagePreview(dataUrl);
      setBusy(true);

      try {
        const [metaPart, base64Data] = dataUrl.split(',');
        const mimeMatch = metaPart.match(/:(.*?);/);
        const mimeType = mimeMatch ? mimeMatch[1] : (file.type || 'image/jpeg');

        const res = await api.post('/photo', {
          image_b64: base64Data,
          mime_type: mimeType === 'image/png' ? 'image/png' : mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg',
        });
        setResult(res);
      } catch (e) {
        setError(e.message || 'Failed to analyze the photo.');
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  }

  function onSelectFile(e) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div style={{ minHeight: '100dvh', padding: '10px var(--gutter) 48px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <CircleBtn icon={ArrowLeft} tooltip="Back" onClick={() => navigate(-1)} />
        <div style={{ height: 28 }} />

        <SectionHead
          kicker="Street audit"
          title="Show us the street."
          accent="street"
          sub="Take or upload a photo. Gemini spots heat traps (bare asphalt, no shade, people waiting in the sun) and suggests what to add."
          size={40}
        />

        <div style={{ height: 22 }} />

        {/* Hidden inputs */}
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onSelectFile}
        />
        <input
          type="file"
          ref={cameraInputRef}
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={onSelectFile}
        />

        {/* Buttons */}
        <Reveal delay={0.2}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Pill
                label="Camera"
                icon={Camera}
                expand
                disabled={busy}
                onClick={() => cameraInputRef.current?.click()}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Pill
                label="Upload"
                icon={ImageIcon}
                kind="outline"
                expand
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              />
            </div>
          </div>
        </Reveal>

        {/* Photo view */}
        {imagePreview && (
          <div style={{ marginTop: 22 }}>
            <Reveal>
              <div style={{
                position: 'relative',
                height: 280,
                borderRadius: 'var(--radius)',
                border: '1px solid var(--rule)',
                overflow: 'hidden',
                background: 'var(--sunk)',
              }}>
                <img
                  src={imagePreview}
                  alt="Street photo"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                {busy && <ScanAnimation />}
              </div>
            </Reveal>
          </div>
        )}

        {busy && (
          <div style={{ marginTop: 16 }}>
            <Kicker>Gemini is looking at your street…</Kicker>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(255,138,91,0.1)', border: '1px solid var(--warn)', borderRadius: 14 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--warn)' }}>{error}</span>
          </div>
        )}

        {/* Result view */}
        {result && (
          <div style={{ marginTop: 28 }}>
            <AuditResult result={result} />
          </div>
        )}
      </div>
    </div>
  );
}

function ScanAnimation() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <motion.div
        animate={{ y: ['-10%', '300%'] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          width: '100%',
          height: 80,
          background: 'linear-gradient(to bottom, rgba(158,227,95,0) 0%, rgba(158,227,95,0.35) 50%, rgba(158,227,95,0) 100%)',
          borderBottom: '2px solid rgba(158,227,95,0.8)',
        }}
      />
    </div>
  );
}

function AuditResult({ result: r }) {
  const navigate = useNavigate();
  const risk = (r.heat_risk || '').toLowerCase();
  const riskColor = risk === 'high' ? 'var(--warn)' : risk === 'low' ? 'var(--accent)' : 'var(--ink)';

  return (
    <div>
      {/* Risk and Shade stats */}
      <Reveal>
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 0', borderBottom: '1px solid var(--rule)' }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>HEAT RISK</span>
            <div style={{ height: 4 }} />
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 600, color: riskColor, letterSpacing: '-0.03em' }}>
              {r.heat_risk?.toUpperCase() || 'UNKNOWN'}
            </span>
          </div>
          <div style={{ width: 1, height: 48, background: 'var(--rule)', margin: '0 20px' }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>SHADE LEVEL</span>
            <div style={{ height: 4 }} />
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.03em' }}>
              {r.shade_level?.toUpperCase() || 'LOW'}
            </span>
          </div>
        </div>
      </Reveal>

      <div style={{ height: 18 }} />

      {/* Surface and Exposure tags */}
      <Reveal delay={0.1}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {r.people_exposed && (
            <span style={{
              padding: '5px 12px',
              borderRadius: 999,
              border: '1px solid var(--warn)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              color: 'var(--warn)',
            }}>
              PEOPLE IN THE SUN
            </span>
          )}
          {(r.surfaces || []).map((s, i) => (
            <span key={i} style={{
              padding: '5px 12px',
              borderRadius: 999,
              border: '1px solid var(--rule)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              color: 'var(--ink)',
            }}>
              {String(s).replace(/_/g, ' ').toUpperCase()}
            </span>
          ))}
        </div>
      </Reveal>

      <div style={{ height: 32 }} />

      {/* Suggestions */}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>SUGGESTIONS</span>
      <div style={{ height: 10 }} />
      <hr />

      {(r.suggestions || []).map((s, i) => {
        const toolKey = s.intervention;
        const Icon = TOOL_ICONS[toolKey] || Trees;
        const label = TOOL_LABELS[toolKey] || toolKey;

        return (
          <Reveal key={i} delay={0.15 + i * 0.08}>
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: '18px 0',
              borderBottom: '1px solid var(--rule)',
              gap: 16,
            }}>
              <div style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                background: 'var(--accent)',
                color: 'var(--on-accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon size={19} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
                  {label} · {s.where}
                </div>
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.5, marginTop: 4 }}>
                  {s.why}
                </div>
              </div>
            </div>
          </Reveal>
        );
      })}

      {r.notes && (
        <div style={{ marginTop: 18 }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>
            {r.notes}
          </p>
        </div>
      )}

      <div style={{ height: 24 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
          Analysed by Gemini. Test on the simulator.
        </span>
        <Pill
          label="Choose block"
          icon={ArrowRight}
          kind="outline"
          dense
          onClick={() => navigate('/')}
        />
      </div>
    </div>
  );
}
