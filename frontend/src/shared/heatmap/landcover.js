// Painted ground when there is no satellite photo (the Map Tiles key is missing or the tiles failed).
// Each cell gets its land-cover colour with a little deterministic grain, so it reads as a hand-painted map, not a grid.

const COLORS = {
  built: [214, 196, 168], road: [122, 124, 120], trees: [96, 150, 78], grass: [146, 190, 104], bare: [205, 180, 138], water: [112, 170, 205],
};
const PX = 8; // pixels per cell

export function paintGround(grid) {
  const { rows, cols, classes, lc } = grid;
  const canvas = document.createElement('canvas');
  canvas.width = cols * PX;
  canvas.height = rows * PX;
  const ctx = canvas.getContext('2d');
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [R, G, B] = COLORS[classes[lc[r * cols + c]]] ?? COLORS.bare;
      ctx.fillStyle = `rgb(${R},${G},${B})`;
      ctx.fillRect(c * PX, r * PX, PX, PX);
    }
  }
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let s = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const n = ((s >>> 24) / 255 - 0.5) * 16;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
