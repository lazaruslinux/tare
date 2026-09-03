import { ChevronRight, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  api,
  errorText,
  type DayRow,
  type DiaryDay,
  type DiaryDays,
  type Me,
  type Measurement,
  type Measurements,
  type Stamp,
  type Profile,
  type Targets,
  type TrendPoint,
} from '../api'
import { DayBars } from '../components/DayBars'
import { BreakdownButton, BreakdownFold, useBreakdown } from '../components/EnergyLines'
import { ExerciseSheet } from '../components/ExerciseSheet'
import { FoodPicker } from '../components/FoodPicker'
import { MeasurementsSheet } from '../components/MeasurementsSheet'
import { MacroBar } from '../components/MacroBar'
import { HEADLINE, nutrientText } from '../components/NutritionLabel'
import { useTopBar } from '../hooks/useTopBar'
import { dayLabel, slotByTime, today } from '../lib/day'
import { personalNumber, calText, monthText } from '../lib/targets'
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
const SPARK_W = 240
const SPARK_H = 44
const SPARK_TALL = 88
const SPARK_PAD = 4

// What one ring is filled to, what stands in its middle, and the words under
// that. A ring is added by adding a spec: the steps one arrives that way, the
// day a phone starts sending steps.
type RingSpec = { key: string; filled: number; centre: string; caption: string }

function Ring({ filled }: { filled: number }) {
  const share = Math.min(Math.max(filled, 0), 1)
  return (
    <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90" aria-hidden="true">
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

// A row of them, side by side and the same size.
function Rings({ rings }: { rings: RingSpec[] }) {
  return (
    <div className="flex items-center gap-4">
      {rings.map((ring) => (
        <div key={ring.key} className="relative shrink-0">
          <Ring filled={ring.filled} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="t-nums text-2xl font-semibold leading-none">{ring.centre}</span>
            <span className="text-xs text-muted">{ring.caption}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// The trend as a line, with the readings themselves as light points around it.
// Taller on the screen that is only about the weight.
function Spark({ trend, points, tall }: {
  trend: TrendPoint[]
  points: Measurement[]
  tall?: boolean
}) {
  if (trend.length < 2) return null
  const height = tall ? SPARK_TALL : SPARK_H
  const days = trend.map((row) => Date.parse(`${row.date}T00:00:00Z`))
  const first = days[0]
  const last = days[days.length - 1]
  const span = Math.max(last - first, 1)
  const values = [...trend.map((row) => row.kg), ...points.map((row) => row.weight_kg)]
  const low = Math.min(...values)
  const high = Math.max(...values)
  // A flat run must not divide by nothing, and it should sit in the middle.
  const range = high - low || 1

  const at = (millis: number, kg: number) => ({
    x: SPARK_PAD + ((millis - first) / span) * (SPARK_W - SPARK_PAD * 2),
    y: height - SPARK_PAD - ((kg - low) / range) * (height - SPARK_PAD * 2),
  })

  const line = trend
    .map((row, index) => {
      const spot = at(days[index], row.kg)
      return `${index === 0 ? 'M' : 'L'}${spot.x.toFixed(1)} ${spot.y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${height}`}
      className={`mt-3 w-full ${tall ? 'h-22' : 'h-11'}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {points.map((row) => {
        const spot = at(Date.parse(`${row.date}T00:00:00Z`), row.weight_kg)
        return (
          <circle key={row.date} cx={spot.x} cy={spot.y} r="1.8" fill="var(--muted)" />
        )
      })}
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  )
}

// Every card wears the same head: the category, which is a way into it, and a
// plus that adds to it.
function CardHead({ label, onOpen, onAdd, extra }: {
  label: string
  onOpen: () => void
  // A card that nothing is added to has no plus, and keeps the head the same
  // height so the cards under each other still line up.
  onAdd?: () => void
  extra?: ReactNode
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
        {extra}
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

export type DashScreen = 'measurements' | 'progress' | null

export function Dashboard({
  me,
  refresh,
  onOpenJournal,
  onOpenProfile,
  start,
  onStarted,
  onScreen,
}: {
  me: Me
  refresh: number
  // The Journal, on today. The Food and Exercise cards both lead there for
  // now; the Exercise one gets its own screen in a later round.
  onOpenJournal: () => void
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
  const [open, toggleBreakdown] = useBreakdown()

  // The wordmark is the header here, and the rail's own name takes over
  // from it at the width the rail appears. The history is a sub-view, and it
  // names the way back.
  useTopBar(
    screen === null
      ? { title: 'Dashboard', left: 'wordmark' }
      : {
          title: screen === 'measurements' ? 'Biometrics' : 'Progress',
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
    setHistory((current) =>
      current === null
        ? current
        : {
            ...current,
            measurements: current.measurements.filter((one) => one.date !== row.date),
          }
    )
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
  // The trend is the smoothed figure the goal is read against; the latest
  // reading is what the scale said this morning.
  const trendKg = trend.length > 0 ? trend[trend.length - 1].kg : null
  // What a personal number is still waiting on, and where to hand it over.
  // The server works the list out, so this never re-derives the rule.
  const gap =
    profile === null || profile.complete ? null : personalNumber(profile.missing)

  // The month the goal is reached at, said once and shown wherever the weight
  // is. Nothing at all without a goal weight.
  const goalMonth =
    targets === null || targets.projection === null
      ? ''
      : ` · Goal about ${monthText(targets.projection.month)}`
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
    const marks = (windowed?.measurements ?? []).filter((row) =>
      line.some((point) => point.date === row.date)
    )
    const over = WINDOWS.find((row) => row.days === span)?.over ?? ''
    const now = line.length > 0 ? line[line.length - 1].kg : null
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
                {weightText(line[line.length - 1].kg, me.units)}
              </span>
              <span className="block text-xs text-muted">
                {changeText(line, me.units, over)}
                {goalMonth}
              </span>
              <Spark trend={line} points={marks} tall />
            </>
          )}
          <div className="mt-2">
            {newest !== null && (
              <Dated
                label="Latest weigh-in"
                value={weightText(newest.value, me.units)}
                date={newest.date}
                todayIso={todayIso}
              />
            )}
            <div className="t-row min-h-9 text-sm">
              <span className="flex-1 text-muted">Trend now</span>
              <span className="t-nums">
                {now === null ? 'No trend yet' : weightText(now, me.units)}
              </span>
            </div>
            <div className="t-row min-h-9 text-sm">
              <span className="flex-1 text-muted">Goal weight</span>
              <span className="t-nums">
                {targets === null || targets.goal_weight_kg === null
                  ? 'No goal yet'
                  : weightText(targets.goal_weight_kg, me.units)}
              </span>
            </div>
          </div>
        </div>

        <div className="t-card mb-3">
          <p className="t-micro mb-2">Last {RUN_DAYS} days</p>
          <DayBars days={run} todayIso={todayIso} height={72} mondaysOnly />
          <p className="t-nums mt-1 text-xs text-muted">
            Days logged {logged} of {RUN_DAYS}
          </p>
        </div>
      </>
    )
  }

  if (screen === 'measurements') {
    return (
      <>
        {rows.length === 0 && (
          <div className="t-card mb-3">
            <p className="text-sm text-muted">No biometrics yet.</p>
            <button
              type="button"
              className="t-btn t-btn-primary mt-3"
              onClick={() => setMeasuring(todayIso)}
            >
              Add biometrics
            </button>
          </div>
        )}

        {rows.map((row) => (
          <div key={row.date} className="t-card mb-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="t-micro">{dayLabel(row.date, todayIso)}</p>
              <button
                type="button"
                className="t-tap44 text-xs text-muted"
                onClick={() => removeMeasurement(row)}
              >
                Delete
              </button>
            </div>
            <button
              type="button"
              className="w-full text-left"
              onClick={() => setMeasuring(row.date)}
            >
              <div className="t-row min-h-9 text-sm">
                <span className="flex-1 text-muted">Weight</span>
                <span className="t-nums">{weightText(row.weight_kg, me.units)}</span>
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
                    {round1(row.muscle_pct)}% · {weightText(row.muscle_kg, me.units)}
                  </span>
                </div>
              )}
              {row.bone_pct !== null && row.bone_kg !== null && (
                <div className="t-row min-h-9 text-sm">
                  <span className="flex-1 text-muted">Bone</span>
                  <span className="t-nums">
                    {round1(row.bone_pct)}% · {weightText(row.bone_kg, me.units)}
                  </span>
                </div>
              )}
              {row.visceral_fat !== null && (
                <div className="t-row min-h-9 text-sm">
                  <span className="flex-1 text-muted">Visceral rating</span>
                  <span className="t-nums">{row.visceral_fat}</span>
                </div>
              )}
              {row.lean_kg !== null && (
                <div className="t-row min-h-9 text-sm">
                  <span className="flex-1 text-muted">Lean weight</span>
                  <span className="t-nums">{weightText(row.lean_kg, me.units)}</span>
                </div>
              )}
            </button>
          </div>
        ))}

        {measuring !== null && (
          <MeasurementsSheet
            me={me}
            date={measuring}
            onClose={() => setMeasuring(null)}
            onSaved={reload}
          />
        )}
        {snackbar}
      </>
    )
  }

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}

      <div className="t-card mb-3">
        <CardHead
          label="Food"
          onOpen={onOpenJournal}
          onAdd={() => setPicking(true)}
          extra={
            day?.energy != null && (
              <BreakdownButton open={open} onToggle={toggleBreakdown} />
            )
          }
        />
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

        {day?.energy != null && <BreakdownFold open={open} energy={day.energy} />}

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
          onOpen={onOpenJournal}
          onAdd={() => setExercising(true)}
        />
        {day === null || day.exercise.length === 0 ? (
          <p className="text-sm text-muted">No exercise logged.</p>
        ) : (
          <>
            {day.exercise.map((row) => (
              <div key={row.id} className="t-row min-h-9 text-sm">
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="t-nums text-muted">
                  {row.minutes} min · about {row.kcal} cal
                </span>
              </div>
            ))}
            <p className="mt-2 text-xs text-muted">
              Includes exercise added: +{day.exercise_kcal} cal
            </p>
          </>
        )}
      </div>

      <div className="t-card mb-3">
        <CardHead label="Progress" onOpen={() => setScreen('progress')} />
        <p className="t-micro mb-1">Weight</p>
        {trendKg === null ? (
          <p className="text-sm text-muted">Weigh in a few more times to see a trend.</p>
        ) : (
          <>
            <span className="t-nums block text-3xl font-semibold leading-tight">
              {weightText(trendKg, me.units)}
            </span>
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
                <Spark trend={trend} points={spots} />
              </>
            )}
          </>
        )}
        <div className="mt-3 border-t border-line pt-3">
          <p className="t-micro mb-2">Last {WEEK} days</p>
          <DayBars days={week} todayIso={todayIso} />
        </div>
      </div>

      <div className="t-card mb-3">
        <CardHead
          label="Biometrics"
          onOpen={() => setScreen('measurements')}
          onAdd={() => setMeasuring(todayIso)}
        />
        {latest === null ? (
          <p className="text-sm text-muted">No biometrics yet.</p>
        ) : (
          <>
            <span className="t-nums block text-3xl font-semibold leading-tight">
              {weightText(latest.weight_kg, me.units)}
            </span>
            <span className="block text-xs text-muted">
              {dayLabel(latest.date, todayIso)}
              {trendKg === null ? '' : ` · your trend ${weightText(trendKg, me.units)}`}
            </span>
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
              {latest.lean_kg !== null && (
                <Dated
                  label="Lean weight"
                  value={weightText(latest.lean_kg, me.units)}
                  date={latest.date}
                  todayIso={todayIso}
                />
              )}
            </div>
          </>
        )}
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
