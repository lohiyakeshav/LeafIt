import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const API = 'http://127.0.0.1:8000';
const apiRoutes = ['blocks', 'areas', 'simulate', 'assumptions', 'agent', 'plans', 'vendors', 'quotes', 'fx'];
// exact route match: a bare '/plans' key would also swallow any page URL that merely starts with it (Vite proxies by prefix)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // shared/model.json is the single source of truth for the cooling model; the backend reads the same file
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    // a browser loading a page (it asks for HTML) gets the app, even where the page URL is also an API path (/vendors, /assumptions)
    proxy: Object.fromEntries(apiRoutes.map(r => [`^/${r}(?:$|[/?])`, { target: API, bypass: (req) => (req.headers.accept?.includes('text/html') ? '/index.html' : undefined) }])),
  },
  test: { environment: 'node', include: ['src/**/*.test.js'] },
});
