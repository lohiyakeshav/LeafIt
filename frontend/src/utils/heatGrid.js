// Heat map utilities — mirrors widgets/heat_grid.dart
export const HEAT_STOPS = [
  [44, 123, 182],   // cool blue  #2C7BB6
  [171, 217, 233],  // light blue #ABD9E9
  [255, 255, 191],  // pale yellow #FFFFBF
  [253, 174, 97],   // orange #FDAE61
  [215, 25, 28],    // hot red #D7191C
];

export function heatColor(t) {
  const x = Math.min(1, Math.max(0, t)) * (HEAT_STOPS.length - 1);
  const i = Math.min(Math.floor(x), HEAT_STOPS.length - 2);
  const f = x - i;
  const a = HEAT_STOPS[i], b = HEAT_STOPS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function heatColorCss(t) {
  const [r, g, b] = heatColor(t);
  return `rgb(${r},${g},${b})`;
}

export function parseBlock(json) {
  if (!json) return null;
  const lst = json.lst ?? json.lst_c ?? [];
  const buildingFrac = json.buildingFrac ?? json.building_frac ?? [];
  const roofArea = json.roofArea ?? json.roof_area_m2 ?? [];
  const classes = json.classes ?? json.landcover_classes ?? [];
  let minT = json.minT, maxT = json.maxT;
  if (minT == null || maxT == null) {
    let min = Infinity, max = -Infinity;
    for (const row of lst) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    minT = isFinite(min) ? min : 30;
    maxT = isFinite(max) ? max : 50;
  }
  return {
    ...json,
    lst,
    lst_c: lst,
    buildingFrac,
    building_frac: buildingFrac,
    roofArea,
    roof_area_m2: roofArea,
    classes,
    landcover_classes: classes,
    minT,
    maxT,
    landmarks: json.landmarks ?? [],
  };
}

/** Draw the heat grid onto a canvas element.
 *  Returns an ImageData that can be drawn scaled.  */
export function drawHeatGrid(canvas, rawBlock, cooling, showAfter) {
  if (!rawBlock || !canvas) return;
  const block = parseBlock(rawBlock);
  const { rows, cols, lst, buildingFrac, minT, maxT } = block;
  const span = Math.max(maxT - minT, 0.1);

  // Offscreen tiny canvas (1px per cell)
  const off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  const ctx = off.getContext('2d');
  const img = ctx.createImageData(cols, rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cool = (showAfter && cooling) ? (cooling[r]?.[c] ?? 0) : 0;
      const t = (lst[r][c] - cool - minT) / span;
      let [pr, pg, pb] = heatColor(t);

      // building shade
      const bf = buildingFrac[r][c];
      if (bf > 0) {
        const alpha = 0.3 * bf;
        pr = Math.round(pr * (1 - alpha));
        pg = Math.round(pg * (1 - alpha));
        pb = Math.round(pb * (1 - alpha));
      }
      // cyan glow for cooling
      if (showAfter && cooling && cool > 0.03) {
        const gAlpha = Math.min(0.75, 0.15 + cool * 0.35);
        // 0x7FD6FF = cool colour
        pr = Math.round(pr * (1 - gAlpha) + 127 * gAlpha);
        pg = Math.round(pg * (1 - gAlpha) + 214 * gAlpha);
        pb = Math.round(pb * (1 - gAlpha) + 255 * gAlpha);
      }

      const idx = (r * cols + c) * 4;
      img.data[idx]     = pr;
      img.data[idx + 1] = pg;
      img.data[idx + 2] = pb;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Scale up to visible canvas
  const vCtx = canvas.getContext('2d');
  vCtx.imageSmoothingEnabled = false;
  vCtx.drawImage(off, 0, 0, canvas.width, canvas.height);

  return off; // caller can cache this for compare slider
}

/** Draw placement icons on canvas */
export function drawPlacements(canvas, block, placements) {
  if (!canvas || !block) return;
  const { rows, cols } = block;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cw = canvas.width / cols;
  const ch = canvas.height / rows;
  const unit = Math.min(cw, ch);

  for (const p of placements) {
    const x = p.col * cw + cw / 2;
    const y = p.row * ch + ch / 2;

    if (p.type === 'tree') {
      const rad = unit * Math.min(0.5, 0.28 + 0.03 * p.count);
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = '#9EE35F';
      ctx.fill();
      ctx.strokeStyle = '#141815';
      ctx.lineWidth = Math.max(1, unit * 0.1);
      ctx.stroke();
    } else if (p.type === 'cool_roof') {
      ctx.strokeStyle = '#E8EDE3';
      ctx.lineWidth = Math.max(1.2, unit * 0.12);
      const inset = unit * 0.14;
      ctx.strokeRect(p.col * cw + inset, p.row * ch + inset, cw - 2 * inset, ch - 2 * inset);
    } else if (p.type === 'shade_stop') {
      const inset = unit * 0.15;
      ctx.fillStyle = '#7FD6FF';
      ctx.fillRect(p.col * cw + inset, p.row * ch + inset, cw - 2 * inset, ch - 2 * inset);
      ctx.strokeStyle = '#141815';
      ctx.lineWidth = Math.max(1, unit * 0.1);
      ctx.strokeRect(p.col * cw + inset, p.row * ch + inset, cw - 2 * inset, ch - 2 * inset);
    }
  }
}

/** Draw landmark labels */
export function drawLandmarks(canvas, block, zoom = 1) {
  if (!canvas || !block?.landmarks?.length) return;
  const { rows, cols, landmarks } = block;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cw = canvas.width / cols;
  const ch = canvas.height / rows;
  const unit = Math.min(cw, ch);
  const r = Math.max(3.5, unit * 0.45) / zoom;
  const fontSize = Math.max(9.5, unit * 0.95) / zoom;

  ctx.font = `500 ${fontSize}px GeistMono, monospace`;

  for (const l of landmarks) {
    const cx = (l.col + 0.5) * cw;
    const cy = (l.row + 0.5) * ch;

    // dot
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#E8EDE3';
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,24,21,0.82)';
    ctx.lineWidth = Math.max(1.5, unit * 0.15) / zoom;
    ctx.stroke();

    // label pill
    const gap = Math.max(6, unit * 0.9) / zoom;
    const padX = 6 / zoom, padY = 3 / zoom;
    const textW = ctx.measureText(l.name).width;
    const boxW = textW + 2 * padX;
    const boxH = fontSize + 2 * padY;
    const right = cx + gap + boxW <= canvas.width;
    const bx = right ? cx + gap : cx - gap - boxW;
    const by = cy - boxH / 2;

    ctx.fillStyle = 'rgba(20,24,21,0.82)';
    const bRad = boxH / 2;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, bRad);
    ctx.fill();

    ctx.fillStyle = '#E8EDE3';
    ctx.fillText(l.name, bx + padX, by + padY + fontSize * 0.82);
  }
}
