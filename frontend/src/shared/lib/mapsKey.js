/** The browser Maps key: from the server at runtime (/config.js, set on Cloud Run), else the build-time one (frontend/.env.local). */
export const mapsKey = () => globalThis.LEAFIT_CONFIG?.mapsKey || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
