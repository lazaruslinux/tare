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
    // A new build downloads in the background and waits. The app puts up one
    // slim bar offering it, so somebody mid-entry is never reloaded out from
    // under what they were typing.
    VitePWA({
      // The worker is written by hand in src/sw.ts rather than generated, so
      // it can answer a push and a tap on the notification it drew. The
      // plugin only fills in the list of files to precache.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      // main.tsx registers it. The content security policy forbids an inline
      // script, which is what the injected tag would be.
      injectRegister: null,
      // public/manifest.webmanifest is hand-written and right; this stops a
      // second one being generated beside it.
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,woff2,wasm}'],
        // The map renderer is not precached. It is only reachable on an
        // instance that installed the basemap, and putting a megabyte of it
        // into every member's phone on the chance they open a route is the
        // opposite of what splitting it out was for.
        // The screenshots on the invite and About are not precached either:
        // they are looked at once, by somebody deciding whether to join.
        globIgnores: [
          '**/mapgl-*.js',
          '**/mapgl-*.css',
          '**/maplibre-gl-worker-*.js',
          '**/screenshots/**',
        ],
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
