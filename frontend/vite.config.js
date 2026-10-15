import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/blocks': 'http://127.0.0.1:8000',
      '/simulate': 'http://127.0.0.1:8000',
      '/assumptions': 'http://127.0.0.1:8000',
      '/agent': 'http://127.0.0.1:8000',
      '/photo': 'http://127.0.0.1:8000',
      '/plans': 'http://127.0.0.1:8000',
      '/vendors': 'http://127.0.0.1:8000',
      '/quotes': 'http://127.0.0.1:8000',
    },
  },
});
