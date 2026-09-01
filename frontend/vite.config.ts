import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5190,
    // Dev only. In a built deployment nginx forwards /api to the api
    // container, so the browser only ever talks to one origin.
    proxy: {
      '/api': 'http://127.0.0.1:8200',
    },
  },
})
