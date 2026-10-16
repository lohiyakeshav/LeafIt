// LeafIt API layer — mirrors app/lib/api.dart exactly
// apiBase: empty string = same origin (dev proxy handles it), or env override

const API_BASE = import.meta.env.VITE_API ?? '';

class ApiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApiError';
  }
}

async function _send(request) {
  let res;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 60_000);
    res = await request(controller.signal);
    clearTimeout(tid);
  } catch (e) {
    if (e.name === 'AbortError') throw new ApiError('The server is taking too long. Please try again.');
    throw new ApiError("Can't reach the LeafIt server. Check your connection and try again.");
  }
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (res.ok) return body;
  const detail = body?.detail;
  if (typeof detail === 'string' && (res.status < 500 || res.status === 503)) throw new ApiError(detail);
  if (res.status >= 500) throw new ApiError('Something went wrong on our side. Please try again.');
  throw new ApiError('Please check your input and try again.');
}

export const api = {
  get: (path, query = {}) => {
    const url = new URL(API_BASE + path, location.href);
    Object.entries(query).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
    return _send(signal => fetch(url.toString(), { signal }));
  },
  post: (path, body) =>
    _send(signal => fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })),
};

export { ApiError };
