import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https:; connect-src 'self'";
// Dev keeps Vite's inline HMR preamble and its websocket, so scripts and
// connections are relaxed while the rest of the policy stays the same.
const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https:; connect-src 'self' ws: wss:";

// The policy applies to every build, dev included.
const cspPlugin = {
  name: 'inject-csp',
  transformIndexHtml: (html, context) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${
        context.server ? DEV_CSP : CSP
      }" />`
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
