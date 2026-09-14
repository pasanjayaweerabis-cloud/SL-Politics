import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = Number(process.env.PORT) || 5173;

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port },
  preview: { host: '127.0.0.1', port: port + 1 },
  // Explicit, not just relying on Vite's current default: a source map would
  // map every minified line straight back to original source, and this
  // project ships no source maps to production on purpose.
  build: { sourcemap: false },
});
