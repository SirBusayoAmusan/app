import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local-first app: no backend, no server routes. The dev/preview servers exist
// only to serve static files, so host checking is opened up for proxied previews.
export default defineConfig({
  /* Relative asset paths, so the built site works from a subpath as well as a
     domain root. GitHub Pages serves project sites from /<repo>/, and absolute
     "/assets/..." URLs would 404 there and appear to "not update". The app uses
     hash routing, so relative paths are always correct. */
  base: './',
  /* Stamped into the bundle so a deployed site can be checked at a glance —
     answers "did my deploy actually update?" without opening devtools. */
  define: { __BUILD_STAMP__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') },
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1600 },
})
