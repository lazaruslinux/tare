import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'

import { api, type Me } from './api'
import { ExerciseSheet } from './components/ExerciseSheet'
import { FoodPicker } from './components/FoodPicker'
import { MeasurementsSheet } from './components/MeasurementsSheet'
import { PlusSheet } from './components/PlusSheet'
import { ScanFlow } from './components/ScanFlow'
import { SideRail } from './components/SideRail'
import { TabBar, type Page } from './components/TabBar'
import { TopBar } from './components/TopBar'
import { entry } from './entry'
import { TopBarContext, useTopBarState } from './hooks/useTopBar'
import { useWaitingCount } from './hooks/useWaitingCount'
import { useWideLayout } from './hooks/useWideLayout'
import { slotByTime, today, type Slot } from './lib/day'
import { Birthdate } from './pages/Birthdate'
import { Dashboard } from './pages/Dashboard'
import { FirstRun } from './pages/FirstRun'
import { FoodTab } from './pages/Food'
import { Journal } from './pages/Journal'
import { Login } from './pages/Login'
import { More, type Screen } from './pages/More'
import { ResetPassword } from './pages/ResetPassword'
import { VerifyEmail } from './pages/VerifyEmail'
import { Welcome } from './pages/Welcome'

// Which screen the whole app is on. Everything except 'signedin' is a single
// centred card, so the shell below is only ever built for somebody who is in.
type Phase =
  | 'loading'
  | 'welcome'
  | 'verify'
  | 'reset'
  | 'anon'
  | 'firstrun'
  | 'birthdate'
  | 'signedin'

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  // An invite, a verification link or a reset link is answered before anything
  // asks who is signed in: all three are opened by somebody who is not.
  const [phase, setPhase] = useState<Phase>(entry.kind === 'app' ? 'loading' : entry.kind)
  const [page, setPage] = useState<Page>('dashboard')
  const [adding, setAdding] = useState(false)
  // Where the add menu was opened from. The rail gives its button's place and
  // gets a popover; the tab bar gives nothing and gets the sheet.
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [picking, setPicking] = useState(false)
  // The scanner, and where what it finds should land. An empty target is now,
  // which is what every way in but the Journal's means.
  const [scanning, setScanning] = useState<{ date?: string; slot?: Slot } | null>(null)
  // Which part of the Food tab to open on. Only ever set by the More page's
  // shortcut into it, and handed back to 'list' the moment the tab has read it.
  const [foodView, setFoodView] = useState<'list' | 'submissions'>('list')
  // Which screen the More tab should open on. Only ever set by something
  // sending somebody straight to it, and handed back once it has been read.
  const [moreView, setMoreView] = useState<Screen>(null)
  // The day the Journal is showing, so the centre control adds to the day
  // being read rather than always to today.
  const [journalDay, setJournalDay] = useState('')
  const [measuring, setMeasuring] = useState(false)
  const [exercising, setExercising] = useState(false)
  // Bumped whenever something is logged from the centre control. The tab
  // underneath stays mounted while that sheet is open, so it is told to read
  // the day again rather than being left showing the day before the meal.
  const [logged, setLogged] = useState(0)
  // Bumped to send the tab that is already open back to its first screen. The
  // remount is the reset: each tab keeps its own view state inside itself.
  const [reset, setReset] = useState(0)
  const wide = useWideLayout()
  const reduced = useReducedMotion()
  const bar = useTopBarState()
  const { waiting, refresh: refreshWaiting } = useWaitingCount(me)

  useEffect(() => {
    if (phase !== 'loading') return
    let alive = true
    api<Me>('/auth/me')
      .then((who) => {
        if (!alive) return
        setMe(who)
        // An account made before tare asked for a birthdate answers that one
        // question before anything else opens.
        setPhase(who.birthdate === null ? 'birthdate' : 'signedin')
      })
      .catch(() => alive && setPhase('anon'))
    return () => {
      alive = false
    }
  }, [phase])

  const select = (next: Page) => {
    if (next === page) {
      // Tapping the tab you are on returns it to its root. The sub-view's
      // history entries are wound back by the root screen registering itself.
      if (bar.hasBack) setReset(reset + 1)
      window.scrollTo(0, 0)
      return
    }
    // A tab is not a stop on the back journey, so the entry is rewritten
    // rather than added and back still means the way out of the app.
    window.history.replaceState({ tab: next }, '')
    setPage(next)
    window.scrollTo(0, 0)
  }

  const openAdd = (from: DOMRect | null) => {
    setAnchor(from)
    setAdding(true)
  }

  const enterFirstRun = async () => {
    // Registration answered "ready", which means the session cookie is already
    // set; this is the account it belongs to.
    setMe(await api<Me>('/auth/me'))
    setPhase('firstrun')
  }

  const enter = (who: Me) => {
    setMe(who)
    // The same question the first load asks: an account without a birthdate
    // answers it before the app opens, whichever door it came through.
    setPhase(who.birthdate === null ? 'birthdate' : 'signedin')
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
  if (phase === 'reset' && entry.kind === 'reset') {
    // Spending the link signs the browser in, so this lands where a sign-in
    // does, birthdate question included.
    return <ResetPassword token={entry.token} onSignedIn={enter} />
  }
  if (phase === 'anon' || me === null) return <Login onSignedIn={enter} />
  if (phase === 'birthdate') return <Birthdate onDone={enter} />
  if (phase === 'firstrun') {
    return (
      <FirstRun
        me={me}
        onDone={(who, openTargets) => {
          if (openTargets) {
            setMoreView('targets')
            setPage('more')
          }
          enter(who)
        }}
      />
    )
  }

  // What the centre control adds to: the day the Journal is showing when that
  // is the tab underneath, and today everywhere else.
  const addDay = page === 'journal' && journalDay ? journalDay : today(me.timezone)

  // Which navigation shows is the stylesheet's call: both are always mounted
  // and each hides itself at the widths the other owns.
  return (
    <TopBarContext.Provider value={bar.register}>
      <div className="t-shell">
        <SideRail active={page} waiting={waiting} onSelect={select} onPlus={openAdd} />
        <div className="t-withrail">
          <div className="t-main">
            <TopBar
              view={bar.view}
              onBack={bar.goBack}
              onStep={bar.step}
              onToday={bar.goToday}
              onAct={bar.act}
              onHome={() => {
                select('dashboard')
                window.scrollTo({ top: 0 })
              }}
            />
            <div className="t-content">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${page}:${reset}`}
                  initial={{ opacity: 0, y: reduced ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduced ? 0 : -10 }}
                  transition={{ duration: 0.18 }}
                >
                  {page === 'more' ? (
                    <More
                      me={me}
                      onChange={setMe}
                      onSignedOut={leave}
                      waiting={waiting}
                      onReviewed={refreshWaiting}
                      onOpenSubmissions={() => {
                        setFoodView('submissions')
                        select('food')
                      }}
                      start={moreView}
                      onStarted={() => setMoreView(null)}
                    />
                  ) : page === 'food' ? (
                    <FoodTab
                      me={me}
                      start={foodView}
                      onStarted={() => setFoodView('list')}
                      onScan={() => setScanning({})}
                    />
                  ) : page === 'journal' ? (
                    <Journal
                      me={me}
                      refresh={logged}
                      onDay={setJournalDay}
                      onScan={(day, slot) => setScanning({ date: day, slot })}
                      onOpenTargets={() => {
                        setMoreView('targets')
                        select('more')
                      }}
                    />
                  ) : (
                    <Dashboard
                      me={me}
                      refresh={logged}
                      onOpenJournal={() => select('journal')}
                      onOpenProfile={() => {
                        setMoreView('profile')
                        select('more')
                      }}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            <TabBar
              active={page}
              waiting={waiting}
              onSelect={select}
              onPlus={() => openAdd(null)}
            />
          </div>
          {wide && (
            <aside className="t-aside">
              <p className="t-micro">Alongside</p>
              <div className="t-card text-sm text-muted">Nothing here yet.</div>
            </aside>
          )}
        </div>
        <PlusSheet
          open={adding}
          anchor={anchor}
          onClose={() => setAdding(false)}
          onScan={() => {
            setAdding(false)
            setScanning({})
          }}
          onAddFood={() => {
            setAdding(false)
            setPicking(true)
          }}
          onMeasure={() => {
            setAdding(false)
            setMeasuring(true)
          }}
          onExercise={() => {
            setAdding(false)
            setExercising(true)
          }}
        />
        {measuring && (
          <MeasurementsSheet
            me={me}
            date={addDay}
            onClose={() => setMeasuring(false)}
            onSaved={() => {
              setMeasuring(false)
              setLogged(logged + 1)
            }}
          />
        )}
        {exercising && (
          <ExerciseSheet
            date={addDay}
            onClose={() => setExercising(false)}
            onSaved={() => {
              setExercising(false)
              setLogged(logged + 1)
            }}
          />
        )}
        {scanning !== null && (
          <ScanFlow
            me={me}
            date={scanning.date}
            slot={scanning.slot}
            onClose={() => setScanning(null)}
            onLogged={() => {
              setScanning(null)
              setLogged(logged + 1)
            }}
          />
        )}
        {picking && (
          <FoodPicker
            me={me}
            date={today(me.timezone)}
            slot={slotByTime(me.timezone)}
            onClose={() => setPicking(false)}
            onLogged={() => {
              setPicking(false)
              setLogged(logged + 1)
            }}
          />
        )}
      </div>
    </TopBarContext.Provider>
  )
}
