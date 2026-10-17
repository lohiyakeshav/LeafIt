import { Reveal } from './Reveal.jsx';
import { Kicker } from './Kicker.jsx';

export function SectionHead({ kicker, title, accent, sub, size = 34 }) {
  return (
    <div>
      <Reveal><Kicker>{kicker}</Kicker></Reveal>
      <div style={{ height: 14 }} />
      <Reveal delay={0.08}>
        <AccentText text={title} accent={accent} style={{ fontSize: size, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1.02, fontFamily: 'var(--font-sans)' }} />
      </Reveal>
      {sub && (
        <>
          <div style={{ height: 10 }} />
          <Reveal delay={0.16}>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--ink-soft)', lineHeight: 1.55 }}>{sub}</p>
          </Reveal>
        </>
      )}
    </div>
  );
}

export function AccentText({ text, accent, style = {}, color = 'var(--accent)' }) {
  if (!accent || !text.includes(accent)) {
    return <span style={style}>{text}</span>;
  }
  const i = text.indexOf(accent);
  const accentSize = typeof style.fontSize === 'number' ? style.fontSize * 1.12 : '1.12em';
  return (
    <span style={style}>
      {text.slice(0, i)}
      <em style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: accentSize, color, lineHeight: style.lineHeight }}>
        {accent}
      </em>
      {text.slice(i + accent.length)}
    </span>
  );
}
