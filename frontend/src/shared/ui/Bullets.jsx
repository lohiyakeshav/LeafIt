import { Reveal } from './Reveal.jsx';

export function Bullets({ text, color = 'var(--ink-soft)' }) {
  const lines = text.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.replace(/^([-•*]|\d+\.)\s*/, '').replace(/\*\*/g, ''));
  return (
    <div>
      {lines.map((line, i) => (
        <Reveal key={i} delay={i * 0.09}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)', paddingTop: 3 }}>—</span>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color, lineHeight: 1.55 }}>{line}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
