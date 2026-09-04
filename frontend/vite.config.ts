import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // A new build downloads in the background and applies on the next open.
    // Nothing on screen asks about it: an update bar is a decision nobody
    // wants to make about a journal.
    VitePWA({
      registerType: 'autoUpdate',
      // main.tsx registers it. The content security policy forbids an inline
      // script, which is what the injected tag would be.
      injectRegister: null,
      // public/manifest.webmanifest is hand-written and right; this stops a
      // second one being generated beside it.
      manifest: false,
      workbox: {
        navigateFallback: '/index.html',
        // The api is never answered from a cache: a cached reading would be
        // yesterday's, and the app refetches on every change and on resume.
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,ico,png,woff2,wasm}'],
      },
    }),
  ],
  server: {
    port: 5190,
    // Dev only. In a built deployment nginx forwards /api to the api
    // container, so the browser only ever talks to one origin.
    proxy: {
      '/api': 'http://127.0.0.1:8200',
    },
  },
})
