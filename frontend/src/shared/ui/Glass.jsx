export function Glass({ children, radius = 999, padding = '0', style = {} }) {
  return (
    <div style={{
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      background: 'var(--glass)',
      border: '1px solid var(--rule)',
      borderRadius: radius,
      padding,
      ...style,
    }}>
      {children}
    </div>
  );
}
