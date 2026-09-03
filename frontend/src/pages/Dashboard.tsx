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
import { DayBars } from '../components/DayBars'
import { BreakdownCard } from '../components/BreakdownCard'
import { ExerciseSheet } from '../components/ExerciseSheet'
import { FoodPicker } from '../components/FoodPicker'
import { MeasurementsSheet } from '../components/MeasurementsSheet'
import { MacroBar } from '../components/MacroBar'
import { HEADLINE, nutrientText } from '../components/NutritionLabel'
import { useTopBar } from '../hooks/useTopBar'
import { dayLabel, slotByTime, today } from '../lib/day'
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

// The sparkline's own box. Drawn in its own coordinates and scaled by the
// stylesheet, so it reads the same on a phone and on a desktop.

// What one ring is filled to, what stands in its middle, and the words under
// that. A ring is added by adding a spec: the steps one arrives that way, the
// day a phone starts sending steps.
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
        strokeLinecap="round"
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
    <div className={`flex items-center ${tight ? 'justify-between gap-2' : 'gap-4'}`}>
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

// The readings, joined by straight lines, each one a round dot. Percent
// coordinates keep the dots round whatever width the card is, because
// nothing here is scaled: the browser lays the box out and the marks sit
// where they are told.
function Spark({ points, tall }: {
  points: { date: string; value: number }[]
  tall?: boolean
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

  return (
    <svg className={`mt-3 w-full ${tall ? 'h-22' : 'h-11'}`} aria-hidden="true">
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
}

// One reading from a phone, small, under the exercise rows. Drawn only once a
// device is connected: three dashes would say nothing.
function Tile({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="t-micro mb-0.5">{label}</p>
      <p className="t-nums text-sm">
        {value === null ? '-' : Math.round(value).toLocaleString()}
      </p>
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

export type DashScreen = 'progress' | null

export function Dashboard({
  me,
  refresh,
  onOpenJournal,
  onOpenFitness,
  onOpenProfile,
  start,
  onStarted,
  onScreen,
}: {
  me: Me
  refresh: number
  // The Journal, on today. The Food card leads there.
  onOpenJournal: () => void
  // The Fitness screen, which is where the Exercise card leads.
  onOpenFitness: () => void
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
  const [picking, setPicking] = useState(false)
  const [measuring, setMeasuring] = useState<string | null>(null)
  const [exercising, setExercising] = useState(false)
  const [pending, setPending] = useState<Measurement | null>(null)
  const pendingRef = useRef<Measurement | null>(null)

  // The wordmark is the header here, and the rail's own name takes over
  // from it at the width the rail appears. The history is a sub-view, and it
  // names the way back.
  useTopBar(
    screen === null
      ? { title: 'Dashboard', left: 'wordmark' }
      : {
          title: 'Progress',
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
  const week = run.slice(-WEEK)

  // The rings the Food card draws. The steps one is a spec like the others and
  // waits only on a day that carries steps, which is device sync.
  const ringBudget = (day?.budget.calories ?? 0) + (day?.exercise_kcal ?? 0)
  const minutesGoal = day?.exercise_minutes_goal ?? 0
  const rings: RingSpec[] = [
    {
      key: 'calories',
      filled: ringBudget <= 0 ? 0 : (day?.totals.calories ?? 0) / ringBudget,
      centre: day === null ? '-' : calText(day.remaining_calories),
      caption: 'remaining',
    },
    {
      key: 'exercise',
      filled: minutesGoal <= 0 ? 0 : (day?.exercise_minutes ?? 0) / minutesGoal,
      centre: day === null ? '-' : String(day.exercise_minutes),
      caption: `of ${minutesGoal} min`,
    },
  ]
  const steps = day?.steps ?? null
  if (steps !== null && targets !== null) {
    rings.push({
      key: 'steps',
      filled: targets.step_goal <= 0 ? 0 : steps / targets.step_goal,
      centre: calText(steps),
      caption: `of ${calText(targets.step_goal)} steps`,
    })
  }

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
    const logged = run.filter((row) => row.logged).length

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
              <Spark points={recorded.map((row) => ({ date: row.date, value: row.weight_kg }))} tall />
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
          <DayBars days={run} todayIso={todayIso} height={72} mondaysOnly />
          <p className="t-nums mt-1 text-xs text-muted">
            Days logged {logged} of {RUN_DAYS}
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

      <BreakdownCard energy={day?.energy ?? null}>
        <CardHead label="Food" onOpen={onOpenJournal} onAdd={() => setPicking(true)} />
        <div className="min-[900px]:flex min-[900px]:items-start min-[900px]:gap-5">
          <div className="min-[900px]:shrink-0">
            <Rings rings={rings} />
            <div className="mt-3 min-w-0">
              <span className="t-nums block text-sm">
                {day === null ? '-' : nutrientText('calories', day.totals.calories ?? 0)}
                <span className="text-muted"> consumed of {day === null ? '-' : calText(day.budget.calories + day.exercise_kcal)}</span>
              </span>
              {day !== null && day.exercise_kcal > 0 && (
                <span className="block text-xs text-muted">
                  Includes exercise added: +{day.exercise_kcal} cal
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 min-[900px]:mt-0 min-[900px]:flex-1">
            {HEADLINE.slice(1).map((fact) => (
              <MacroBar
                key={fact.key}
                label={fact.label}
                value={day === null ? null : day.totals[fact.key]}
                target={day?.budget[fact.key] ?? 0}
                unit={fact.unit}
              />
            ))}
          </div>
        </div>

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
      </BreakdownCard>

      <div className="t-card mb-3">
        <CardHead
          label="Exercise"
          onOpen={onOpenFitness}
          onAdd={() => setExercising(true)}
        />
        {day === null || day.exercise.length === 0 ? (
          <p className="text-sm text-muted">No exercise logged.</p>
        ) : (
          <>
            {day.exercise.map((row) => (
              <div key={row.id ?? `w${row.workout_id}`} className="t-row min-h-9 text-sm">
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="t-nums text-muted">
                  {row.minutes} min
                  {row.kcal === null ? '' : ` · about ${row.kcal} cal`}
                </span>
              </div>
            ))}
          </>
        )}
        {fitness !== null && fitness.connected && (
          <div className="mt-3 flex gap-6 border-t border-line pt-3">
            <Tile label="Steps" value={fitness.today.steps} />
            <Tile label="Active cal" value={fitness.today.active_kcal} />
            <Tile label="Resting" value={fitness.today.resting_hr} />
          </div>
        )}
      </div>

      <div className="t-card mb-3">
        <CardHead
          label="Progress"
          onOpen={() => setScreen('progress')}
          onAdd={() => setMeasuring(todayIso)}
        />
        {/* The scale's own number leads and the trend rides the line under it,
            so one card carries both without two big numbers on one screen. */}
        <button
          type="button"
          className="t-micro t-tap44 mb-1 flex items-center gap-1"
          onClick={() => setScreen('progress')}
        >
          Biometrics
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
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
                <Spark points={spots.map((row) => ({ date: row.date, value: row.weight_kg }))} />
              </>
            )}
            <div className="mt-1">
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
          </>
        )}
        <div className="mt-3 border-t border-line pt-3">
          <p className="t-micro mb-2">Intake, last {WEEK} days</p>
          <DayBars days={week} todayIso={todayIso} />
        </div>
      </div>

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
