// Share a plan as a link, no database: the placements are packed into the URL (compact JSON → deflate → base64url).
// A few hundred trees fit in a link of ~1-2 kB, well within what browsers and chat apps accept.

const pack = (items) => items.map((it) => (it.type === 'cool_roof'
  ? ['r', it.buildingId ?? null, it.cells]
  : [it.type === 'tree' ? 't' : 's', Math.round(it.x * 10) / 10, Math.round(it.z * 10) / 10]));

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** items -> URL-safe string */
export async function encodePlan(items, years) {
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, y: years, p: pack(items) }));
  const z = await pipe(json, new CompressionStream('deflate-raw'));
  let out = '';
  for (let i = 0; i < z.length; i += 0x8000) out += String.fromCharCode(...z.subarray(i, i + 0x8000)); // no call-stack limit on big plans
  return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** URL string -> { years, packed: [['t'|'s', x, z] | ['r', buildingId, cells]] } or null if it isn't a valid plan */
export async function decodePlan(s) {
  try {
    const json = await pipe(fromB64url(s), new DecompressionStream('deflate-raw'));
    const d = JSON.parse(new TextDecoder().decode(json));
    return d?.v === 1 && Array.isArray(d.p) ? { years: d.y, packed: d.p } : null;
  } catch {
    return null;
  }
}

/** Phone share sheet where there is one, clipboard otherwise. Resolves to 'shared' | 'copied'. */
export async function shareLink(url, title) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    await navigator.share({ title, url });
    return 'shared';
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}


