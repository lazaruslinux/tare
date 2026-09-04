import { ChevronRight, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  api,
  errorText,
  type DayRow,
  type DiaryDay,
  type DiaryDays,
  type FitnessSummary,
  type Me,
  type Measurement,
  type Measurements,
  type Stamp,
  type Profile,
  type Targets,
  type TrendPoint,
} from '../api'
import { barsAverage, DayBars, type Bar } from '../components/DayBars'
import { ExerciseSheet } from '../components/ExerciseSheet'
import { FoodPicker } from '../components/FoodPicker'
import { MeasurementsSheet } from '../components/MeasurementsSheet'
import { Feed } from '../components/Feed'
import { MemberView } from '../components/MemberView'
import { WorkoutDetails } from '../components/WorkoutDetails'
import { useTopBar } from '../hooks/useTopBar'
import { useWideLayout } from '../hooks/useWideLayout'
import { dayLabel, shiftDay, slotByTime, today, weekday } from '../lib/day'
import { personalNumber, calText, dateText } from '../lib/targets'
import { round1, weightIn, weightText, weightUnit } from '../lib/units'

// How far back the weight line reaches, and how long a deleted reading can be
// brought back.
const SPARK_DAYS = 30
const HISTORY_DAYS = 90
const UNDO = 6000

// How many days of eating the card shows and the Progress screen shows. Both
// come from the one request, because a month of days is a few hundred bytes.
const WEEK = 7
const RUN_DAYS = 28

// The windows the Progress screen offers for the weight line, and where the
// chosen one is remembered.
const WINDOWS = [
  { days: 30, label: '30 days', over: 'over 30 days' },
  { days: 90, label: '90 days', over: 'over 90 days' },
  { days: 365, label: '1 year', over: 'over 1 year' },
]
const WINDOW_KEY = 'tare.progress.window'

function rememberedWindow(): number {
  try {
    const kept = Number(window.localStorage.getItem(WINDOW_KEY))
    return WINDOWS.some((row) => row.days === kept) ? kept : WINDOWS[0].days
  } catch {
    return WINDOWS[0].days
  }
}

// The ring, drawn by hand: a circle whose stroke is dashed to the share of the
// day that has been consumed. No library, and nothing that moves.
const RADIUS = 42
const ROUND = 2 * Math.PI * RADIUS

// What one ring is filled to, what stands in its middle, and the words under
// that.
type RingSpec = { key: string; filled: number; centre: string; caption: string }

function Ring({ filled, small }: { filled: number; small?: boolean }) {
  const share = Math.min(Math.max(filled, 0), 1)
  return (
    <svg
      viewBox="0 0 100 100"
      className={`${small ? 'h-24 w-24' : 'h-28 w-28'} -rotate-90`}
      aria-hidden="true"
    >
      <circle
        cx="50"
        cy="50"
        r={RADIUS}
        fill="none"
        stroke="var(--line-strong)"
        strokeWidth="8"
      />
      <circle
        cx="50"
        cy="50"
        r={RADIUS}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="8"
        // A round cap on nothing is still a dot, and a ring with no answer in
        // it has to read as empty.
        strokeLinecap={share === 0 ? 'butt' : 'round'}
        strokeDasharray={`${share * ROUND} ${ROUND}`}
      />
    </svg>
  )
}

// A row of them, side by side and the same size. Three rings do not fit a
// phone at the size two of them wear, so the whole row steps down together
// rather than the last one running off the edge of the card.
function Rings({ rings }: { rings: RingSpec[] }) {
  const tight = rings.length > 2
  return (
    // Spread across a phone, clustered on a wide card: three rings a foot
    // apart read as three cards.
    <div
      className={`flex items-center ${
        tight ? 'justify-between gap-2 min-[900px]:justify-start min-[900px]:gap-12' : 'gap-4'
      }`}
    >
      {rings.map((ring) => (
        <div key={ring.key} className="relative shrink-0">
          <Ring filled={ring.filled} small={tight} />
          <div className={`absolute inset-0 flex flex-col items-center justify-center ${tight ? 'px-3' : 'px-2'}`}>
            <span
              className={`t-nums font-semibold leading-none ${tight ? 'text-xl' : 'text-2xl'}`}
            >
              {ring.centre}
            </span>
            <span
              className={`text-center leading-tight text-muted ${
                tight ? 'max-w-[3.75rem] text-[10px]' : 'text-xs'
              }`}
            >
              {ring.caption}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// How many dates fit under a line on a phone without touching each other.
const MAX_TICKS = 5

// Which readings get a date under them: all of them while there are few, and
// past that the first, the last, and evenly spaced ones between.
function ticked(count: number): number[] {
  if (count <= 6) return Array.from({ length: count }, (_, index) => index)
  const step = (count - 1) / (MAX_TICKS - 1)
  const picked = new Set<number>()
  for (let i = 0; i < MAX_TICKS; i += 1) picked.add(Math.round(i * step))
  return [...picked].sort((a, b) => a - b)
}

// "Aug 30". No year: a line this short never crosses one the reader is unsure
// about, and the year would cost the room the next date needs.
const tickText = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  })

// The readings, joined by straight lines, each one a round dot. Percent
// coordinates keep the dots round whatever width the card is, because
// nothing here is scaled: the browser lays the box out and the marks sit
// where they are told.
//
// With an axis the line gets a ground to stand on and its dots get dates, so
// that a weight line is not read as whatever number happens to sit beside it.
function Spark({ points, tall, axis }: {
  points: { date: string; value: number }[]
  tall?: boolean
  axis?: boolean
}) {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1))
  if (sorted.length < 2) return null
  const days = sorted.map((row) => Date.parse(`${row.date}T00:00:00Z`))
  const first = days[0]
  const span = Math.max(days[days.length - 1] - first, 1)
  const values = sorted.map((row) => row.value)
  const low = Math.min(...values)
  const high = Math.max(...values)
  // A flat run must not divide by nothing, and it should sit in the middle.
  const range = high - low || 1
  const inset = 6
  const at = (index: number) => ({
    x: inset + ((days[index] - first) / span) * (100 - inset * 2),
    y: 100 - inset - ((values[index] - low) / range) * (100 - inset * 2),
  })
  const spots = sorted.map((_, index) => at(index))
  const dated = axis === true ? ticked(sorted.length) : []

  const line = (
    <svg className={`w-full ${tall ? 'h-22' : 'h-11'}`} aria-hidden="true">
      {spots.slice(1).map((spot, index) => (
        <line
          key={sorted[index + 1].date}
          x1={`${spots[index].x}%`}
          y1={`${spots[index].y}%`}
          x2={`${spot.x}%`}
          y2={`${spot.y}%`}
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
      {spots.map((spot, index) => (
        <circle
          key={sorted[index].date}
          cx={`${spot.x}%`}
          cy={`${spot.y}%`}
          r="3.5"
          fill="var(--accent)"
        />
      ))}
    </svg>
  )

  if (axis !== true) return <div className="mt-3">{line}</div>

  return (
    <div className="mt-3">
      {line}
      {/* The ground is a border rather than a stroke, so it lands on a whole
          pixel in both themes and the ticks hang off it. */}
      <div className="relative border-t border-line">
        {spots.map((spot, index) => (
          <span
            key={sorted[index].date}
            className="absolute top-0 h-1 w-px bg-line-strong"
            style={{ left: `${spot.x}%` }}
          />
        ))}
        {/* The row keeps its height whether or not a date sits in it, so the
            card does not jump when the readings change. */}
        <div className="relative h-4">
          {dated.map((index) => (
            <span
              key={sorted[index].date}
              className="absolute top-0.5 text-[10px] leading-none text-muted"
              style={
                index === dated[0]
                  ? { left: 0 }
                  : index === dated[dated.length - 1]
                    ? { right: 0 }
                    : { left: `${spots[index].x}%`, transform: 'translateX(-50%)' }
              }
            >
              {tickText(sorted[index].date)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// Every card wears the same head: the category, which is a way into it, and a
// plus that adds to it.
function CardHead({ label, onOpen, onAdd }: {
  label: string
  onOpen: () => void
  // A card that nothing is added to has no plus, and keeps the head the same
  // height so the cards under each other still line up.
  onAdd?: () => void
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <button
        type="button"
        className="t-micro t-tap44 flex items-center gap-1"
        onClick={onOpen}
      >
        {label}
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
      <span className="flex items-center gap-2">
        {onAdd === undefined ? (
          <span className="t-topbar-icon -mr-2" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="t-topbar-icon -mr-2"
            aria-label={`Add ${label.toLowerCase()}`}
            onClick={onAdd}
          >
            <Plus className="h-5 w-5" strokeWidth={2} />
          </button>
        )}
      </span>
    </div>
  )
}

// How far the weight has moved across a window, in the member's own units.
// Under a tenth of a unit is not a change anybody can act on.
function changeText(line: TrendPoint[], units: Me['units'], over: string): string {
  const moved =
    weightIn(line[line.length - 1].kg, units) - weightIn(line[0].kg, units)
  const size = round1(Math.abs(moved))
  if (size < 0.1) return `No change ${over}`
  return `${moved < 0 ? '−' : '+'}${size} ${weightUnit(units)} ${over}`
}

// One measured number with the day it was last taken under it.
function Dated({
  label,
  value,
  date,
  todayIso,
}: {
  label: string
  value: string
  date: string
  todayIso: string
}) {
  return (
    <div className="t-row min-h-9 text-sm">
      <span className="flex-1 text-muted">{label}</span>
      <span className="text-right">
        <span className="t-nums block">{value}</span>
        <span className="block text-xs text-muted">{dayLabel(date, todayIso)}</span>
      </span>
    </div>
  )
}

// A share of the weight with the mass it works out to beside it.
function shareText(stamp: Stamp, units: Me['units']): string {
  const mass = stamp.mass_kg ?? null
  return mass === null
    ? `${round1(stamp.value)}%`
    : `${round1(stamp.value)}% · ${weightText(mass, units)}`
}

// One recorded day, as the History card draws it: the day it was, a way to
// take it back off, and every line that was measured with the weight.
function WeighIn({
  row,
  units,
  todayIso,
  onOpen,
}: {
  row: Measurement
  units: Me['units']
  todayIso: string
  onOpen: () => void
}) {
  return (
    <div>
      <p className="t-micro mb-1">{dayLabel(row.date, todayIso)}</p>
      <button type="button" className="w-full text-left" onClick={onOpen}>
        <div className="t-row min-h-9 text-sm">
          <span className="flex-1 text-muted">Weight</span>
          <span className="t-nums">{weightText(row.weight_kg, units)}</span>
        </div>
        {row.body_fat_pct !== null && (
          <div className="t-row min-h-9 text-sm">
            <span className="flex-1 text-muted">Body fat</span>
            <span className="t-nums">{round1(row.body_fat_pct)}%</span>
          </div>
        )}
        {row.body_water_pct !== null && (
          <div className="t-row min-h-9 text-sm">
            <span className="flex-1 text-muted">Body water</span>
            <span className="t-nums">{round1(row.body_water_pct)}%</span>
          </div>
        )}
        {row.muscle_pct !== null && row.muscle_kg !== null && (
          <div className="t-row min-h-9 text-sm">
            <span className="flex-1 text-muted">Muscle</span>
            <span className="t-nums">
              {round1(row.muscle_pct)}% · {weightText(row.muscle_kg, units)}
            </span>
          </div>
        )}
        {row.bone_pct !== null && row.bone_kg !== null && (
          <div className="t-row min-h-9 text-sm">
            <span className="flex-1 text-muted">Bone</span>
            <span className="t-nums">
              {round1(row.bone_pct)}% · {weightText(row.bone_kg, units)}
            </span>
          </div>
        )}
        {row.visceral_fat !== null && (
          <div className="t-row min-h-9 text-sm">
            <span className="flex-1 text-muted">Visceral rating</span>
            <span className="t-nums">{row.visceral_fat}</span>
          </div>
        )}
      </button>
    </div>
  )
}

export type DashScreen = 'progress' | 'community' | null

export function Dashboard({
  me,
  refresh,
  onOpenJournal,
  onOpenFitness,
  onOpenTargets,
  onOpenProfile,
  onChanged,
  start,
  onStarted,
  onScreen,
}: {
  me: Me
  refresh: number
  // Said upward when something on a sub-view changed a list the rest of the
  // app is showing.
  onChanged?: () => void
  // The Journal, on today. The Food card leads there.
  onOpenJournal: () => void
  // The Fitness screen, which is where the Exercise card leads.
  onOpenFitness: () => void
  // Targets, which is where the goals the rings are read against are set.
  onOpenTargets: () => void
  onOpenProfile: () => void
  // Which screen to open on. Only ever set by something outside this tab
  // sending somebody straight to it, and handed back the moment it is read.
  start?: DashScreen
  onStarted?: () => void
  // Which screen this is on, said upward so the rail can light the row that
  // leads to it.
  onScreen?: (screen: DashScreen) => void
}) {
  const todayIso = today(me.timezone)
  // At the width the right-hand column appears, the feed lives there and this
  // tab does not draw a card for it as well.
  const wide = useWideLayout()
  const [day, setDay] = useState<DiaryDay | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [history, setHistory] = useState<Measurements | null>(null)
  const [run, setRun] = useState<DayRow[]>([])
  const [targets, setTargets] = useState<Targets | null>(null)
  // What a phone sent for today. Null until it answers, and the strip it draws
  // appears only once a device is connected.
  const [fitness, setFitness] = useState<FitnessSummary | null>(null)
  // The weight line for whichever window the Progress screen is on, which is
  // its own request: a trend over a year is not a trend over a month cut short.
  const [span, setSpan] = useState(rememberedWindow)
  const [windowed, setWindowed] = useState<Measurements | null>(null)
  const [error, setError] = useState('')
  const [again, setAgain] = useState(0)
  const [screen, setScreen] = useState<DashScreen>(null)
  // The two things a Dashboard row can open over the tab: one workout, and
  // whoever did it. Held here rather than in the screen union, because each
  // of them is about a row and not about a screen.
  const [workout, setWorkout] = useState<number | null>(null)
  const [member, setMember] = useState<number | null>(null)
  const [picking, setPicking] = useState(false)
  const [measuring, setMeasuring] = useState<string | null>(null)
  const [exercising, setExercising] = useState(false)
  const [pending, setPending] = useState<Measurement | null>(null)
  const pendingRef = useRef<Measurement | null>(null)

  // The wordmark is the header here, and the rail's own name takes over
  // from it at the width the rail appears. The history is a sub-view, and it
  // names the way back.
  // Nothing to say while one of the two sub-views is up: each names itself.
  useTopBar(
    workout !== null || member !== null
      ? null
      : screen === null
        ? { title: 'Dashboard', left: 'wordmark' }
        : {
            title: screen === 'community' ? 'Community' : 'Progress',
            back: { label: 'Dashboard', onBack: () => setScreen(null) },
          }
  )

  // A screen asked for from outside is opened once, and then this tab owns
  // where it is again.
  useEffect(() => {
    if (start === undefined || start === null) return
    setScreen(start)
    onStarted?.()
  }, [start, onStarted])

  useEffect(() => {
    onScreen?.(screen)
    // Leaving the tab leaves nothing behind for the rail to light.
    return () => onScreen?.(null)
  }, [screen, onScreen])

  useEffect(() => {
    let alive = true
    api<DiaryDay>(`/diary/day?date=${todayIso}`)
      .then((loaded) => alive && setDay(loaded))
      .catch((failure) => alive && setError(errorText(failure)))
    api<Profile>('/health/profile')
      .then((loaded) => alive && setProfile(loaded))
      .catch(() => undefined)
    api<Measurements>(`/health/measurements?days=${HISTORY_DAYS}`)
      .then((loaded) => alive && setHistory(loaded))
      .catch(() => undefined)
    api<DiaryDays>(`/diary/days?days=${RUN_DAYS}`)
      .then((loaded) => alive && setRun(loaded.days))
      .catch(() => undefined)
    api<Targets>('/health/targets')
      .then((loaded) => alive && setTargets(loaded))
      .catch(() => undefined)
    api<FitnessSummary>(`/fitness/summary?date=${todayIso}`)
      .then((loaded) => alive && setFitness(loaded))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [me.timezone, todayIso, refresh, again])

  // Only while that screen is open, and again whenever the window changes.
  useEffect(() => {
    if (screen !== 'progress') return
    let alive = true
    api<Measurements>(`/health/measurements?days=${span}`)
      .then((loaded) => alive && setWindowed(loaded))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [screen, span, refresh, again])

  const erase = (row: Measurement) => {
    pendingRef.current = null
    api(`/health/measurements/${row.date}`, { method: 'DELETE' }).catch(() => {
      // The row is already off the screen, and the next read tells the truth.
    })
  }

  useEffect(() => {
    if (pending === null) return
    const timer = window.setTimeout(() => {
      erase(pending)
      setPending(null)
    }, UNDO)
    return () => window.clearTimeout(timer)
  }, [pending])

  useEffect(
    () => () => {
      if (pendingRef.current !== null) erase(pendingRef.current)
    },
    []
  )

  // Remembered per device: somebody who reads their year does it again.
  const pickWindow = (days: number) => {
    setSpan(days)
    try {
      window.localStorage.setItem(WINDOW_KEY, String(days))
    } catch {
      // A browser that refuses storage still gets the window it picked.
    }
  }

  const reload = () => {
    setPicking(false)
    setMeasuring(null)
    setExercising(false)
    setAgain(again + 1)
  }

  const removeMeasurement = (row: Measurement) => {
    // Off both lists, because the card that shows the rows and the card that
    // draws the trend are reading two different windows of the same log.
    const without = (current: Measurements | null) =>
      current === null
        ? current
        : {
            ...current,
            measurements: current.measurements.filter((one) => one.date !== row.date),
          }
    setHistory(without)
    setWindowed(without)
    pendingRef.current = row
    setPending(row)
  }

  const undo = () => {
    pendingRef.current = null
    setPending(null)
    setAgain(again + 1)
  }

  const rows = history?.measurements ?? []
  const latest = rows[0] ?? null
  // Each number's own newest reading, so the card can say how old it is.
  const stamps = history?.latest ?? null
  // Whether the card has any of them to show, which is what the rule above
  // them is for.
  const scaleRows =
    stamps !== null &&
    [
      stamps.body_fat_pct,
      stamps.body_water_pct,
      stamps.muscle_pct,
      stamps.bone_pct,
      stamps.visceral_fat,
    ].some((one) => one !== null)
  const trend = (history?.trend ?? []).slice(-SPARK_DAYS)
  const spots = rows.filter((row) => trend.some((point) => point.date === row.date))
  // What a personal number is still waiting on, and where to hand it over.
  // The server works the list out, so this never re-derives the rule.
  const gap =
    profile === null || profile.complete ? null : personalNumber(profile.missing)

  // The month the goal is reached at, said once and shown wherever the weight
  // is. Nothing at all without a goal weight.
  const goalMonth =
    targets === null || targets.projection === null
      ? ''
      : ` · Goal ${dateText(targets.projection.date)}`
  // The week somebody is standing in, Monday first, the way a week is read.
  // Sunday closes the week that began six days ago rather than opening one.
  const elapsed = ((weekday(todayIso) + 6) % 7) + 1
  const mondayIso = shiftDay(todayIso, -(elapsed - 1))
  // The whole frame, Monday to Sunday. The days still to come are drawn as
  // gaps, so the letters read as the week and not as however far into it the
  // member is.
  const weekDates = Array.from({ length: WEEK }, (_, index) => shiftDay(mondayIso, index))
  const week = run.filter((row) => row.date >= mondayIso)
  // What today is read against, which is what a day nobody has reached yet is
  // drawn against as well.
  const weekBudget = run.length === 0 ? 0 : run[run.length - 1].budget

  // The week as one picture: what was eaten against the day's number, and the
  // line under it. The bars and the sentences above them read the same rows.
  const intake: Bar[] = weekDates.map((date) => {
    const row = week.find((one) => one.date === date)
    return row === undefined
      ? { date, value: 0, target: weekBudget, has: false }
      : { date, value: row.calories, target: row.budget, has: row.logged }
  })
  const loggedWeek = week.filter((row) => row.logged)
  const underTarget = loggedWeek.filter((row) => row.calories <= row.budget).length
  const completedWeek = week.filter((row) => row.completed).length
  const intakeFooter =
    loggedWeek.length === 0
      ? 'Log a few days to see them here.'
      : `Average ${calText(barsAverage(intake))} cal a day · budget ${calText(weekBudget)}`

  // The same week in steps, when a phone is sending them. The goal is the one
  // set on Activity goals; the fitness answer carries the same figure and
  // stands in until targets arrive.
  const stepGoal = targets?.step_goal ?? fitness?.goals.steps ?? 0
  const stepWeek = (fitness?.week ?? []).filter((row) => row.date >= mondayIso)
  const stepBars: Bar[] = weekDates.map((date) => {
    const row = stepWeek.find((one) => one.date === date)
    return {
      date,
      value: row?.steps ?? 0,
      target: stepGoal,
      has: row !== undefined && row.steps !== null,
    }
  })
  const goalMet = stepBars.filter((row) => row.has && row.value >= stepGoal).length
  const stepsFooter =
    stepBars.every((row) => !row.has)
      ? 'Sync a few days to see them here.'
      : `Average ${calText(barsAverage(stepBars))} steps a day · goal ${calText(stepGoal)}`
  const sessions = fitness?.week_workouts ?? 0
  const sessionsLine =
    sessions === 0 ? 'No workouts' : sessions === 1 ? '1 workout' : `${sessions} workouts`
  const movedDays = week.filter((row) => row.exercise_kcal > 0).length

  // Today as three rings: what was walked, what is left to eat, and what was
  // worked. The row is always three, so a phone that sends nothing shows an
  // empty steps ring rather than moving the other two.
  const steps = day?.steps ?? null
  const remaining = day?.remaining_calories ?? 0
  const ringBudget = (day?.budget.calories ?? 0) + (day?.exercise_kcal ?? 0)
  const minutesGoal = day?.exercise_minutes_goal ?? 0
  const rings: RingSpec[] = [
    {
      key: 'steps',
      filled: steps === null || stepGoal <= 0 ? 0 : steps / stepGoal,
      centre: steps === null ? '\u2013' : calText(steps),
      caption: steps === null ? 'Sync a device' : `of ${calText(stepGoal)} steps`,
    },
    {
      key: 'calories',
      filled: ringBudget <= 0 ? 0 : (day?.totals.calories ?? 0) / ringBudget,
      centre: day === null ? '\u2013' : calText(Math.abs(remaining)),
      caption: remaining < 0 ? 'over' : 'left',
    },
    {
      key: 'exercise',
      filled: minutesGoal <= 0 ? 0 : (day?.exercise_minutes ?? 0) / minutesGoal,
      centre: day === null ? '\u2013' : String(day.exercise_minutes),
      caption: `of ${minutesGoal} min`,
    },
  ]

  // The same calories, said once more in small type on the card that is about
  // eating. The big version of this number lives in the Journal.
  const leftToday =
    remaining < 0
      ? `${calText(Math.abs(remaining))} cal over today`
      : `${calText(remaining)} cal left today`

  const snackbar = pending !== null && (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 px-4">
      <div className="pointer-events-auto mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
        <span className="min-w-0 truncate">Deleted {pending.date}.</span>
        <button type="button" className="font-semibold text-accent" onClick={undo}>
          Undo
        </button>
      </div>
    </div>
  )

  if (workout !== null) {
    return (
      <WorkoutDetails
        me={me}
        workoutId={workout}
        back="Dashboard"
        onBack={() => setWorkout(null)}
        onOpenMember={(userId) => {
          setWorkout(null)
          setMember(userId)
        }}
        onChanged={onChanged}
      />
    )
  }

  if (member !== null) {
    return <MemberView userId={member} back="Dashboard" onBack={() => setMember(null)} />
  }

  if (screen === 'community') {
    return (
      <div className="t-card mb-3">
        <Feed
          me={me}
          refresh={refresh}
          onOpenWorkout={setWorkout}
          onOpenMember={setMember}
        />
      </div>
    )
  }

  if (screen === 'progress') {
    const line = windowed?.trend ?? []
    const over = WINDOWS.find((row) => row.days === span)?.over ?? ''
    // The rows this window holds, and the body fat inside them read oldest
    // first, which is the order a line is drawn in.
    const recorded = windowed?.measurements ?? []
    const fatLine: TrendPoint[] = [...recorded]
      .reverse()
      .filter((row) => row.body_fat_pct !== null)
      .map((row) => ({ date: row.date, kg: row.body_fat_pct as number }))
    const newest = windowed?.latest.weight_kg ?? null
    const completedRun = run.filter((row) => row.completed).length
    const runBars: Bar[] = run.map((row) => ({
      date: row.date,
      value: row.calories,
      target: row.budget,
      has: row.logged,
    }))
    const runLogged = run.filter((row) => row.logged)
    const runBudget = run.length === 0 ? 0 : run[run.length - 1].budget
    const runFooter =
      runLogged.length === 0
        ? 'Log a few days to see them here.'
        : `Average ${calText(barsAverage(runBars))} cal a day · budget ${calText(runBudget)}`

    return (
      <>
        <div className="t-card mb-3">
          <div className="mb-2 flex flex-wrap gap-2">
            {WINDOWS.map((row) => (
              <button
                key={row.days}
                type="button"
                aria-pressed={span === row.days}
                className={`t-chip ${span === row.days ? 'border-accent text-accent' : ''}`}
                onClick={() => pickWindow(row.days)}
              >
                {row.label}
              </button>
            ))}
          </div>
          {line.length < 2 ? (
            <p className="text-sm text-muted">Weigh in a few more times to see a trend.</p>
          ) : (
            <>
              <span className="t-nums block text-3xl font-semibold leading-tight">
                {newest === null
                  ? weightText(line[line.length - 1].kg, me.units)
                  : weightText(newest.value, me.units)}
              </span>
              <span className="block text-xs text-muted">
                {newest === null ? '' : `${dayLabel(newest.date, todayIso)} · `}
                {changeText(line, me.units, over)}
                {goalMonth}
              </span>
              <Spark
                points={recorded.map((row) => ({ date: row.date, value: row.weight_kg }))}
                tall
                axis
              />
            </>
          )}
          <div className="mt-2">
            <div className="t-row min-h-9 text-sm">
              <span className="flex-1 text-muted">Goal weight</span>
              <span className="t-nums">
                {targets === null || targets.goal_weight_kg === null
                  ? 'No goal yet'
                  : weightText(targets.goal_weight_kg, me.units)}
              </span>
            </div>
            {recorded[0]?.lean_kg != null && (
              <div className="t-row min-h-9 text-sm">
                <span className="flex-1 text-muted">Lean weight</span>
                <span className="t-nums">{weightText(recorded[0].lean_kg, me.units)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="t-card mb-3">
          <p className="t-micro mb-2">Intake, last {RUN_DAYS} days</p>
          <DayBars
            bars={runBars}
            footer={runFooter}
            todayIso={todayIso}
            height={72}
            mondaysOnly
            warnOver
          />
          <p className="t-nums mt-1 text-xs text-muted">
            Days completed {completedRun} of {RUN_DAYS}
          </p>
        </div>

        <div className="t-card mb-3">
          <p className="t-micro mb-2">History</p>
          {fatLine.length > 1 && (
            <div className="mb-3">
              <p className="t-micro">Body fat</p>
              <Spark points={fatLine.map((row) => ({ date: row.date, value: row.kg }))} />
            </div>
          )}
          {recorded.length === 0 ? (
            <>
              <p className="text-sm text-muted">No weigh-ins in this window.</p>
              <button
                type="button"
                className="t-btn t-btn-primary mt-3"
                onClick={() => setMeasuring(todayIso)}
              >
                Log weigh-in
              </button>
            </>
          ) : (
            recorded.map((row, index) => (
              <div
                key={row.date}
                className={index === 0 ? '' : 'mt-3 border-t border-line pt-3'}
              >
                <WeighIn
                  row={row}
                  units={me.units}
                  todayIso={todayIso}
                  onOpen={() => setMeasuring(row.date)}
                />
              </div>
            ))
          )}
        </div>

        {measuring !== null && (
          <MeasurementsSheet
            me={me}
            date={measuring}
            onClose={() => setMeasuring(null)}
            onSaved={reload}
            onDelete={() => {
              const row = rows.find((one) => one.date === measuring)
              setMeasuring(null)
              if (row) removeMeasurement(row)
            }}
          />
        )}
        {snackbar}
      </>
    )
  }

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}

      {/* The whole card is the way into the goals these are read against, so
          the head is drawn rather than a CardHead: a button inside a button is
          not a thing a screen reader can hand anybody. */}
      <button
        type="button"
        className="t-card mb-3 block w-full text-left"
        aria-label="Today's rings. Opens activity goals."
        onClick={onOpenTargets}
      >
        <span className="t-micro mb-2 flex items-center gap-1">
          Today
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
        <Rings rings={rings} />
      </button>

      <div className="t-card mb-3">
        <CardHead label="Food" onOpen={onOpenJournal} onAdd={() => setPicking(true)} />
        {day !== null && <p className="t-nums mb-2 text-xs text-muted">{leftToday}</p>}
        <p className="t-micro mb-2">This week</p>
        {loggedWeek.length === 0 ? (
          <p className="text-base font-semibold tracking-tight">Log a day to see your week.</p>
        ) : (
          <p className="text-base font-semibold tracking-tight">
            Within calorie budget {underTarget} of {elapsed} days
          </p>
        )}
        <p className="mb-3 text-xs text-muted">
          Completed {completedWeek} of {elapsed} days
        </p>
        <DayBars
          bars={intake}
          footer={intakeFooter}
          todayIso={todayIso}
          warnOver
          highlightToday
        />

        {gap !== null && (
          <button
            type="button"
            className="mt-3 text-sm text-accent"
            onClick={() =>
              gap.needs === 'weight' ? setMeasuring(todayIso) : onOpenProfile()
            }
          >
            {gap.label}
          </button>
        )}
      </div>

      <div className="t-card mb-3">
        <CardHead
          label="Exercise"
          onOpen={onOpenFitness}
          onAdd={() => setExercising(true)}
        />
        <p className="t-micro mb-2">This week</p>
        {fitness !== null && fitness.connected ? (
          <>
            <p className="text-base font-semibold tracking-tight">
              Step goal met {goalMet} of {elapsed} days
            </p>
            <p className="mb-3 text-xs text-muted">{sessionsLine}</p>
            <DayBars
              bars={stepBars}
              footer={stepsFooter}
              todayIso={todayIso}
              highlightToday
            />
          </>
        ) : (
          <>
            <p className="text-base font-semibold tracking-tight">
              Exercise on {movedDays} of {elapsed} days
            </p>
            <p className="text-xs text-muted">Sync a device to see steps here.</p>
          </>
        )}
      </div>

      <div className="t-card mb-3">
        <CardHead
          label="Progress"
          onOpen={() => setScreen('progress')}
          onAdd={() => setMeasuring(todayIso)}
        />
        {/* One head on the card. The scale's own number leads and the trend
            rides the line under it, so one card carries both without two big
            numbers on one screen. */}
        {latest === null ? (
          <p className="text-sm text-muted">No biometrics yet.</p>
        ) : (
          <>
            <span className="t-nums block text-3xl font-semibold leading-tight">
              {weightText(latest.weight_kg, me.units)}
            </span>
            {/* The smoothed figure stays off the card: the change and the goal
                date underneath are read from it, and one number is enough. */}
            <span className="block text-xs text-muted">{dayLabel(latest.date, todayIso)}</span>
            {trend.length < 2 ? (
              <span className="block text-xs text-muted">
                Weigh in a few more times to see a trend.
              </span>
            ) : (
              <>
                <span className="block text-xs text-muted">
                  {changeText(trend, me.units, WINDOWS[0].over)}
                  {goalMonth}
                </span>
                <Spark
                  points={spots.map((row) => ({ date: row.date, value: row.weight_kg }))}
                  axis
                />
              </>
            )}
            {/* The dated readings are their own block: without the rule the
                first of them reads as a label on the end of the line. */}
            {scaleRows && (
              <div className="mt-3 border-t border-line pt-2">
                {stamps?.body_fat_pct && (
                  <Dated
                    label="Body fat"
                    value={`${round1(stamps.body_fat_pct.value)}%`}
                    date={stamps.body_fat_pct.date}
                    todayIso={todayIso}
                  />
                )}
                {stamps?.body_water_pct && (
                  <Dated
                    label="Body water"
                    value={`${round1(stamps.body_water_pct.value)}%`}
                    date={stamps.body_water_pct.date}
                    todayIso={todayIso}
                  />
                )}
                {stamps?.muscle_pct && (
                  <Dated
                    label="Muscle"
                    value={shareText(stamps.muscle_pct, me.units)}
                    date={stamps.muscle_pct.date}
                    todayIso={todayIso}
                  />
                )}
                {stamps?.bone_pct && (
                  <Dated
                    label="Bone"
                    value={shareText(stamps.bone_pct, me.units)}
                    date={stamps.bone_pct.date}
                    todayIso={todayIso}
                  />
                )}
                {stamps?.visceral_fat && (
                  <Dated
                    label="Visceral rating"
                    value={String(stamps.visceral_fat.value)}
                    date={stamps.visceral_fat.date}
                    todayIso={todayIso}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {!wide && (
        <div className="t-card mb-3">
          <CardHead label="Community" onOpen={() => setScreen('community')} />
          <Feed
            me={me}
            limit={3}
            refresh={refresh}
            onOpenWorkout={setWorkout}
            onOpenMember={setMember}
          />
        </div>
      )}

      {picking && (
        <FoodPicker
          me={me}
          date={todayIso}
          slot={slotByTime(me.timezone)}
          onClose={() => setPicking(false)}
          onLogged={reload}
        />
      )}

      {measuring !== null && (
        <MeasurementsSheet
          me={me}
          date={measuring}
          onClose={() => setMeasuring(null)}
          onSaved={reload}
        />
      )}

      {exercising && (
        <ExerciseSheet
          date={todayIso}
          onClose={() => setExercising(false)}
          onSaved={reload}
        />
      )}

      {snackbar}
    </>
  )
}
