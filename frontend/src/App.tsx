import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useState } from 'react'

import { PlaceholderPage } from './components/PlaceholderPage'
import { PlusSheet } from './components/PlusSheet'
import { SideRail } from './components/SideRail'
import { TabBar, type Page } from './components/TabBar'
import { useWideLayout } from './hooks/useWideLayout'

const PAGES: Record<Page, { title: string; note: string }> = {
  dashboard: { title: 'Dashboard', note: 'The day at a glance will be shown here.' },
  journal: { title: 'Journal', note: 'What you ate today will be listed here.' },
  food: { title: 'Food', note: 'The shared food database will be searched from here.' },
  more: { title: 'More', note: 'Account and instance settings will be found here.' },
}

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [adding, setAdding] = useState(false)
  const wide = useWideLayout()
  const reduced = useReducedMotion()

  const select = (next: Page) => {
    setPage(next)
    window.scrollTo(0, 0)
  }

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
                <PlaceholderPage title={PAGES[page].title} note={PAGES[page].note} />
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
