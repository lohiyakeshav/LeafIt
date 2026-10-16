import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const API = 'http://127.0.0.1:8000';
const apiRoutes = ['blocks', 'areas', 'simulate', 'assumptions', 'agent', 'photo', 'plans', 'vendors', 'quotes'];
// exact route match: a bare '/photo' key would also swallow page URLs like /photo-audit (Vite proxies by prefix)

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
    proxy: Object.fromEntries(apiRoutes.map(r => [`^/${r}(?:$|[/?])`, API])),
  },
  test: { environment: 'node', include: ['src/**/*.test.js'] },
});
