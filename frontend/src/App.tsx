import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'

import { api, type Me } from './api'
import { PlaceholderPage } from './components/PlaceholderPage'
import { PlusSheet } from './components/PlusSheet'
import { SideRail } from './components/SideRail'
import { TabBar, type Page } from './components/TabBar'
import { entry } from './entry'
import { useWideLayout } from './hooks/useWideLayout'
import { FirstRun } from './pages/FirstRun'
import { Login } from './pages/Login'
import { Settings } from './pages/Settings'
import { VerifyEmail } from './pages/VerifyEmail'
import { Welcome } from './pages/Welcome'

const PAGES: Record<Exclude<Page, 'more'>, { title: string; note: string }> = {
  dashboard: { title: 'Dashboard', note: 'The day at a glance will be shown here.' },
  journal: { title: 'Journal', note: 'What you ate today will be listed here.' },
  food: { title: 'Food', note: 'The shared food database will be searched from here.' },
}

// Which screen the whole app is on. Everything except 'signedin' is a single
// centred card, so the shell below is only ever built for somebody who is in.
type Phase = 'loading' | 'welcome' | 'verify' | 'anon' | 'firstrun' | 'signedin'

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  // An invite or a verification link is answered before anything asks who is
  // signed in: both are opened by somebody who is not.
  const [phase, setPhase] = useState<Phase>(entry.kind === 'app' ? 'loading' : entry.kind)
  const [page, setPage] = useState<Page>('dashboard')
  const [adding, setAdding] = useState(false)
  const wide = useWideLayout()
  const reduced = useReducedMotion()

  useEffect(() => {
    if (phase !== 'loading') return
    let alive = true
    api<Me>('/auth/me')
      .then((who) => {
        if (!alive) return
        setMe(who)
        setPhase('signedin')
      })
      .catch(() => alive && setPhase('anon'))
    return () => {
      alive = false
    }
  }, [phase])

  const select = (next: Page) => {
    setPage(next)
    window.scrollTo(0, 0)
  }

  const enterFirstRun = async () => {
    // Registration answered "ready", which means the session cookie is already
    // set; this is the account it belongs to.
    setMe(await api<Me>('/auth/me'))
    setPhase('firstrun')
  }

  const enter = (who: Me) => {
    setMe(who)
    setPhase('signedin')
  }

  const leave = () => {
    setMe(null)
    setPage('dashboard')
    setPhase('anon')
  }

  // Nothing at all while the first call is out. The ground is already the right
  // colour, and a spinner for a request this short is a flicker.
  if (phase === 'loading') return null
  if (phase === 'welcome' && entry.kind === 'welcome') {
    return <Welcome code={entry.code} onReady={enterFirstRun} />
  }
  if (phase === 'verify' && entry.kind === 'verify') {
    return <VerifyEmail token={entry.token} onSignIn={() => setPhase('anon')} />
  }
  if (phase === 'anon' || me === null) return <Login onSignedIn={enter} />
  if (phase === 'firstrun') return <FirstRun me={me} onDone={enter} />

  // Which navigation shows is the stylesheet's call: both are always mounted
  // and each hides itself at the widths the other owns.
  return (
    <div className="t-shell">
      <SideRail active={page} onSelect={select} onPlus={() => setAdding(true)} />
      <div className="t-withrail">
        <div className="t-main">
          <div className="t-content">
            <AnimatePresence mode="wait">
              <motion.div
                key={page}
                initial={{ opacity: 0, y: reduced ? 0 : 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduced ? 0 : -10 }}
                transition={{ duration: 0.18 }}
              >
                {page === 'more' ? (
                  <Settings me={me} onChange={setMe} onSignedOut={leave} />
                ) : (
                  <PlaceholderPage title={PAGES[page].title} note={PAGES[page].note} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <TabBar active={page} onSelect={select} onPlus={() => setAdding(true)} />
        </div>
        {wide && (
          <aside className="t-aside">
            <p className="t-micro">Alongside</p>
            <div className="t-card text-sm text-muted">Nothing here yet.</div>
          </aside>
        )}
      </div>
      <PlusSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
