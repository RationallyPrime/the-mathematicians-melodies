import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

// SWC transpile + Lightning CSS, per the house stack. The dev server proxies
// the API so the app uses same-origin relative URLs in dev and prod alike.
export default defineConfig({
  plugins: [react()],
  css: { transformer: 'lightningcss' },
  build: { cssMinify: 'lightningcss' },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/openapi.json': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
