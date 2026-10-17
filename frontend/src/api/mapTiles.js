// The real ground: Google Map Tiles API (2D, satellite) stitched into one canvas and cropped to the selected area.
// The Map Tiles API is the Google product licensed for custom renderers like this one (Static/JS map imagery is not).
// Tile math is pure and unit-tested; fetching needs VITE_GOOGLE_MAPS_API_KEY with "Map Tiles API" enabled.

const TILE = 256;
const MAX_TEXTURE_PX = 1536; // caps a 1 km² area at ~25 tiles (z17): sharp enough for a stylised view, and each tile is a billable request
const MAX_ZOOM = 19;

const lngToPx = (lng, z) => ((lng + 180) / 360) * TILE * 2 ** z;
const latToPx = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};

/** Sharpest zoom whose stitched image still fits in MAX_TEXTURE_PX on both sides. */
export function pickZoom({ north, south, east, west }, maxPx = MAX_TEXTURE_PX) {
  for (let z = MAX_ZOOM; z > 1; z--) {
    if (lngToPx(east, z) - lngToPx(west, z) <= maxPx && latToPx(south, z) - latToPx(north, z) <= maxPx) return z;
  }
  return 1;
}

/** Which tiles to fetch and where the area sits inside the stitched canvas. */
export function tilePlan(bounds, z) {
  const left = lngToPx(bounds.west, z), right = lngToPx(bounds.east, z);
  const top = latToPx(bounds.north, z), bottom = latToPx(bounds.south, z);
  const x0 = Math.floor(left / TILE), x1 = Math.floor((right - 1e-9) / TILE);
  const y0 = Math.floor(top / TILE), y1 = Math.floor((bottom - 1e-9) / TILE);
  return { z, x0, x1, y0, y1, cropX: left - x0 * TILE, cropY: top - y0 * TILE, cropW: right - left, cropH: bottom - top };
}

export const hasMapsKey = () => Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);

let sessionPromise = null;
function session(key) {
  sessionPromise ??= fetch(`https://tile.googleapis.com/v1/createSession?key=${key}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'IN' }),
  }).then((r) => { if (!r.ok) throw new Error(`Map Tiles session failed (${r.status})`); return r.json(); })
    .then((j) => j.session)
    .catch((e) => { sessionPromise = null; throw e; });
  return sessionPromise;
}

/**
 * -> { canvas, copyright } for the bounds, or throws. Tiles load in parallel; the browser's HTTP cache means a prefetch from
 * the map page (same tiles) makes the Studio load near-instant.
 */
export async function fetchSatellite(bounds, { signal } = {}) {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('No Google Maps key configured');
  const plan = tilePlan(bounds, pickZoom(bounds));
  const token = await session(key);

  const jobs = [];
  for (let y = plan.y0; y <= plan.y1; y++) for (let x = plan.x0; x <= plan.x1; x++) {
    jobs.push(fetch(`https://tile.googleapis.com/v1/2dtiles/${plan.z}/${x}/${y}?session=${token}&key=${key}`, { signal })
      .then((r) => { if (!r.ok) throw new Error(`tile ${x},${y}: ${r.status}`); return r.blob(); })
      .then(createImageBitmap)
      .then((img) => ({ img, x, y })));
  }
  const viewport = fetch(`https://tile.googleapis.com/tile/v1/viewport?session=${token}&key=${key}&zoom=${plan.z}` +
    `&north=${bounds.north}&south=${bounds.south}&east=${bounds.east}&west=${bounds.west}`, { signal })
    .then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

  const tiles = await Promise.all(jobs);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(plan.cropW));
  canvas.height = Math.max(1, Math.round(plan.cropH));
  const ctx = canvas.getContext('2d');
  for (const { img, x, y } of tiles) ctx.drawImage(img, (x - plan.x0) * TILE - plan.cropX, (y - plan.y0) * TILE - plan.cropY);
  tiles.forEach(({ img }) => img.close?.());
  const { copyright } = await viewport;
  return { canvas, copyright: copyright || 'Imagery © Google and data providers' };
}
