import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The three packages the map is made of, matched on where they were installed
// from rather than by name, so nothing else that happens to mention them is
// swept into the chunk.
const MAP_LIBRARIES = /node_modules[\\/](maplibre-gl|pmtiles|@protomaps[\\/]basemaps)[\\/]/

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
        // The map renderer is not precached. It is only reachable on an
        // instance that installed the basemap, and putting a megabyte of it
        // into every member's phone on the chance they open a route is the
        // opposite of what splitting it out was for.
        globIgnores: ['**/mapgl-*.js', '**/mapgl-*.css', '**/maplibre-gl-worker-*.js'],
      },
    }),
  ],
  build: {
    rollupOptions: {
      // The renderer, the archive reader and the basemap style in one chunk of
      // their own, so nothing about the map rides along in the main bundle.
      // A function rather than the older map of names: the bundler under Vite
      // 8 takes only this shape.
      output: {
        manualChunks: (id) => (MAP_LIBRARIES.test(id) ? 'mapgl' : undefined),
      },
    },
  },
  server: {
    port: 5190,
    // Dev only. In a built deployment nginx forwards /api to the api
    // container, so the browser only ever talks to one origin.
    proxy: {
      '/api': 'http://127.0.0.1:8200',
    },
  },
})
