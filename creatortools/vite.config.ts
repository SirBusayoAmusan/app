import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local-first app: no backend, no server routes. The dev/preview servers exist
// only to serve static files, so host checking is opened up for proxied previews.
export default defineConfig({
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
