// theme first: it writes data-theme onto the root element on the way in, so
// the first paint is already on the right ground. The font and the stylesheet
// follow, then the app.
import './theme'
import '@fontsource-variable/inter'
import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
