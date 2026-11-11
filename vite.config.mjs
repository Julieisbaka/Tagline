import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https:";

// Strict CSP for production builds only (dev needs Vite's inline HMR preamble).
const cspPlugin = {
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`
    ),
};

const platform = process.env.TAGLINE_TARGET_PLATFORM || process.platform;
if (!['win32', 'darwin', 'linux'].includes(platform)) {
  throw new Error(`Unsupported renderer target: ${platform}`);
}

export default defineConfig({
  plugins: [react(), cspPlugin],
  resolve: {
    alias: {
      '@platform-settings': fileURLToPath(
        new URL(`./src/platform/${platform}.json`, import.meta.url)
      ),
    },
  },
  base: './',
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
  },
});
