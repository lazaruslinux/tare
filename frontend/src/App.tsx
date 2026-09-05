import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'

import { api, type Me } from './api'
import { Aside } from './components/Aside'
import { ExerciseSheet } from './components/ExerciseSheet'
import { FoodPicker } from './components/FoodPicker'
import { MeasurementsSheet } from './components/MeasurementsSheet'
import { MemberView } from './components/MemberView'
import { PlusSheet } from './components/PlusSheet'
import { ScanFlow } from './components/ScanFlow'
import { SideRail } from './components/SideRail'
import { TabBar, type Page, type RailTarget } from './components/TabBar'
import { TopBar } from './components/TopBar'
import { WorkoutDetails } from './components/WorkoutDetails'
import { entry } from './entry'
import { useResume } from './hooks/useResume'
import { TopBarContext, useTopBarState } from './hooks/useTopBar'
import { useWaitingCount } from './hooks/useWaitingCount'
import { useWideLayout } from './hooks/useWideLayout'
import { setClock } from './lib/clock'
import { slotByTime, today, type Slot } from './lib/day'
import { Birthdate } from './pages/Birthdate'
import { Dashboard, type DashScreen } from './pages/Dashboard'
import { FirstRun } from './pages/FirstRun'
import { FoodTab } from './pages/Food'
import { Journal } from './pages/Journal'
import { Login } from './pages/Login'
import { More, type Screen } from './pages/More'
import { ResetPassword } from './pages/ResetPassword'
import { VerifyEmail } from './pages/VerifyEmail'
import { Welcome } from './pages/Welcome'

// What the right-hand column has opened over the tab: one workout, or the
// member who did it.
type Overlay = { kind: 'workout'; id: number } | { kind: 'member'; id: number } | null

// What the way back out of one is called, which is the tab it is standing on.
const TAB_TITLE: Record<Page, string> = {
  dashboard: 'Dashboard',
  journal: 'Journal',
  food: 'Food',
  more: 'More',
}

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
  // A food the Food tab should open on. Only ever set by something outside it
  // sending somebody to a food, and handed back the moment the tab has read it.
  const [foodOpen, setFoodOpen] = useState<number | null>(null)
  // Which screen the More tab should open on. Only ever set by something
  // sending somebody straight to it, and handed back once it has been read.
  const [moreView, setMoreView] = useState<Screen>(null)
  // The same for the Dashboard's one sub-view.
  const [dashView, setDashView] = useState<DashScreen>(null)
  // Which screen each of those two is really showing. Reported upward so the
  // rail can light the row that leads to it rather than the page holding it.
  const [moreScreen, setMoreScreen] = useState<Screen>(null)
  const [dashScreen, setDashScreen] = useState<DashScreen>(null)
  // The day the Journal is showing, so the centre control adds to the day
  // being read rather than always to today.
  const [journalDay, setJournalDay] = useState('')
  const [measuring, setMeasuring] = useState(false)
  const [exercising, setExercising] = useState(false)
  // What the right-hand column opened, shown in the main well as a sub-view of
  // whichever tab is underneath. One state, one place: the column is the same
  // on every tab, so what it opens cannot belong to any one of them.
  const [overlay, setOverlay] = useState<Overlay>(null)
  // The app-wide change tick. Bumped whenever something changed on the server,
  // wherever it was changed from, and whenever the app came back to the front
  // after being left. Every tab watches it and reads its lists again, so a food
  // added in one place shows up in the others without anybody leaving the app.
  // It refetches lists and nothing else: no view state is keyed on it.
  const [logged, setLogged] = useState(0)
  // Bumped to send the tab that is already open back to its first screen. The
  // remount is the reset: each tab keeps its own view state inside itself.
  const [reset, setReset] = useState(0)
  const wide = useWideLayout()
  const reduced = useReducedMotion()
  const bar = useTopBarState()
  const { waiting, queue, refresh: refreshWaiting } = useWaitingCount(me)
  const changed = useCallback(() => setLogged((n) => n + 1), [])
  // Every way the account arrives or changes goes through here, so the clock
  // preference the formatters read is never a save behind what was saved.
  const remember = useCallback((who: Me | null) => {
    if (who !== null) setClock(who.clock)
    setMe(who)
  }, [])

  // Back from wherever somebody went. Everything on screen is read again, the
  // badge included, because time passed and another device may have moved.
  useResume(() => {
    if (me === null) return
    changed()
    refreshWaiting()
  })

  useEffect(() => {
    if (phase !== 'loading') return
    let alive = true
    api<Me>('/auth/me')
      .then((who) => {
        if (!alive) return
        remember(who)
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
    setOverlay(null)
    setPage(next)
    window.scrollTo(0, 0)
  }

  // The rail draws two rows that are not pages: each opens a screen inside one,
  // the same way the Journal's own shortcut into Targets does.
  const selectRail = (target: RailTarget) => {
    if (target === 'targets') {
      setMoreView('targets')
      select('more')
      return
    }
    if (target === 'measurements') {
      // The row still reads Biometrics, because that is what somebody is
      // looking for. What it opens is the screen the weigh-ins live on now.
      setDashView('progress')
      select('dashboard')
      return
    }
    if (target === 'fitness') {
      setMoreView('fitness')
      select('more')
      return
    }
    select(target)
  }

  // The bar's centre button stays in reach while its sheet is up, so a second
  // tap closes what the first opened.
  const openAdd = (from: DOMRect | null) => {
    setAnchor(from)
    setAdding((was) => !was)
  }

  const enterFirstRun = async () => {
    // Registration answered "ready", which means the session cookie is already
    // set; this is the account it belongs to.
    remember(await api<Me>('/auth/me'))
    setPhase('firstrun')
  }

  const enter = (who: Me) => {
    remember(who)
    // The same question the first load asks: an account without a birthdate
    // answers it before the app opens, whichever door it came through.
    setPhase(who.birthdate === null ? 'birthdate' : 'signedin')
  }

  const leave = () => {
    remember(null)
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
        <SideRail
          active={page}
          moreScreen={moreScreen}
          dashScreen={dashScreen}
          waiting={waiting}
          onSelect={selectRail}
          onPlus={openAdd}
        />
        <div className="t-withrail">
          <div className="t-main">
            <TopBar
              view={bar.view}
              onBack={bar.goBack}
              onStep={bar.step}
              onToday={bar.goToday}
              onAct={bar.act}
              onToggleMark={bar.toggleMark}
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
                  {overlay !== null ? (
                    overlay.kind === 'workout' ? (
                      <WorkoutDetails
                        me={me}
                        workoutId={overlay.id}
                        back={TAB_TITLE[page]}
                        onBack={() => setOverlay(null)}
                        onOpenMember={(userId) =>
                          setOverlay({ kind: 'member', id: userId })
                        }
                        onChanged={changed}
                      />
                    ) : (
                      <MemberView
                        userId={overlay.id}
                        back={TAB_TITLE[page]}
                        onBack={() => setOverlay(null)}
                      />
                    )
                  ) : page === 'more' ? (
                    <More
                      me={me}
                      onChange={remember}
                      onSignedOut={leave}
                      waiting={queue}
                      refresh={logged}
                      onReviewed={refreshWaiting}
                      onChanged={changed}
                      onOpenBiometrics={() => selectRail('measurements')}
                      onOpenFood={(id) => {
                        setFoodOpen(id)
                        select('food')
                      }}
                      start={moreView}
                      onStarted={() => setMoreView(null)}
                      onScreen={setMoreScreen}
                    />
                  ) : page === 'food' ? (
                    <FoodTab
                      me={me}
                      open={foodOpen}
                      refresh={logged}
                      onOpened={() => setFoodOpen(null)}
                      onScan={() => setScanning({})}
                      onSeen={refreshWaiting}
                      onChanged={changed}
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
                      onChanged={changed}
                    />
                  ) : (
                    <Dashboard
                      me={me}
                      refresh={logged}
                      onOpenJournal={() => select('journal')}
                      onOpenFitness={() => {
                        setMoreView('fitness')
                        select('more')
                      }}
                      onChanged={changed}
                      start={dashView}
                      onStarted={() => setDashView(null)}
                      onScreen={setDashScreen}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            <TabBar
              active={page}
              waiting={waiting}
              onSelect={(tab) => {
                setAdding(false)
                select(tab)
              }}
              onPlus={() => openAdd(null)}
            />
          </div>
          {wide && (
            <aside className="t-aside">
              <Aside
                me={me}
                refresh={logged}
                waiting={queue}
                onOpenWorkout={(id) => setOverlay({ kind: 'workout', id })}
                onOpenMember={(id) => setOverlay({ kind: 'member', id })}
              />
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
              changed()
            }}
          />
        )}
        {exercising && (
          <ExerciseSheet
            date={addDay}
            onClose={() => setExercising(false)}
            onSaved={() => {
              setExercising(false)
              changed()
            }}
          />
        )}
        {scanning !== null && (
          <ScanFlow
            me={me}
            date={scanning.date}
            slot={scanning.slot}
            onClose={() => setScanning(null)}
            onChanged={changed}
            onLogged={() => {
              setScanning(null)
              changed()
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
              changed()
            }}
          />
        )}
      </div>
    </TopBarContext.Provider>
  )
}
