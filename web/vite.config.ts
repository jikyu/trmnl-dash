import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    proxy: {
      // changeOrigin sets Host to 127.0.0.1:8787, which the server's Host check accepts.
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
})
