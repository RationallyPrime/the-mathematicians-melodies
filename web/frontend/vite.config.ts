import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

// SWC transpile + Tailwind v4 (whose engine IS Lightning CSS, so the house
// "Lightning CSS always" rule holds — Tailwind owns CSS transform now; we keep
// Lightning CSS as the production minifier). The dev server proxies the API so
// the app uses same-origin relative URLs in dev and prod alike.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { cssMinify: 'lightningcss' },
  server: {
    port: 4321,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5678', changeOrigin: true },
      '/openapi.json': { target: 'http://127.0.0.1:5678', changeOrigin: true },
    },
  },
})
