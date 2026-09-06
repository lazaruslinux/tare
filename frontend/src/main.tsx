// theme first: it writes data-theme onto the root element on the way in, so
// the first paint is already on the right ground. The font and the stylesheet
// follow, then the app.
import './theme'
import '@fontsource-variable/inter'
import '@fontsource/righteous'
import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

// The service worker. Registered from here rather than from a tag the plugin
// injects, because the content security policy forbids an inline script. A new
// build is fetched in the background and applied on the next open.
registerSW({ immediate: true })

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
