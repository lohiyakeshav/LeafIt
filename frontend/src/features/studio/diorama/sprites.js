// Painterly tree sprites drawn procedurally (no image assets to ship or load): three crown shapes with a baked ground shadow.
export const TREE_VARIANTS = 3;
const W = 128, H = 176;

export function makeTreeAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = W * TREE_VARIANTS;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const shapes = [
    [[0, -92, 40], [-26, -70, 30], [26, -72, 30], [0, -58, 34]],
    [[-4, -96, 36], [-28, -76, 28], [24, -78, 32], [-14, -58, 30], [18, -56, 28]],
    [[0, -100, 30], [-22, -82, 28], [22, -84, 28], [-26, -60, 26], [26, -60, 26], [0, -66, 32]],
  ];
  for (let v = 0; v < TREE_VARIANTS; v++) {
    ctx.save();
    ctx.translate(v * W + W / 2, H - 14);
    ctx.fillStyle = 'rgba(20,40,20,0.28)';           // baked shadow: no real-time shadow maps needed
    ctx.beginPath(); ctx.ellipse(8, 2, 40, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6b4a2f';                        // trunk
    ctx.fillRect(-4, -62, 8, 62);
    for (const [x, y, r] of shapes[v]) {
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
      g.addColorStop(0, '#9ed36a'); g.addColorStop(0.6, '#5f9e3f'); g.addColorStop(1, '#3f7a31');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(30,70,30,0.35)'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
  }
  return canvas;
}
