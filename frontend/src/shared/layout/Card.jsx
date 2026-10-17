/** A titled card for desktop sections */
export function Card({ title, kicker, children, style }) {
  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--radius)', padding: 28, ...style }}>
      {kicker && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em', color: 'var(--muted)', marginBottom: 8 }}>{kicker}</div>}
      {title && <h2 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.15, marginBottom: 14 }}>{title}</h2>}
      {children}
    </section>
  );
}
