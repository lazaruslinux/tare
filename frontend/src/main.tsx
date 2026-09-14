// theme first: it writes data-theme onto the root element on the way in, so
// the first paint is already on the right ground. The font and the stylesheet
// follow, then the app.
import './theme'
import '@fontsource-variable/figtree'
import '@fontsource/righteous'
import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AsideSlotProvider } from './lib/asideSlot'
import { updateReady } from './lib/update'

// The service worker. Registered from here rather than from a tag the plugin
// injects, because the content security policy forbids an inline script. A new
// build is fetched in the background; the bar it puts up is what applies it,
// and closing the app applies it anyway.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateReady(() => {
      void updateSW(true)
    })
  },
})

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <AsideSlotProvider>
        <App />
      </AsideSlotProvider>
    </ErrorBoundary>
  </StrictMode>
)
