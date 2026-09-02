import { ChevronRight, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  api,
  errorText,
  type DiaryDay,
  type Me,
  type Measurement,
  type Measurements,
  type Stamp,
  type Profile,
} from '../api'
import { ExerciseSheet } from '../components/ExerciseSheet'
import { FoodPicker } from '../components/FoodPicker'
import { MeasurementsSheet } from '../components/MeasurementsSheet'
import { MacroBar } from '../components/MacroBar'
import { HEADLINE, nutrientText } from '../components/NutritionLabel'
import { useTopBar } from '../hooks/useTopBar'
import { dayLabel, slotByTime, today } from '../lib/day'
import { round1, weightText } from '../lib/units'

// How far back the weight line reaches, and how long a deleted reading can be
// brought back.
const SPARK_DAYS = 30
const HISTORY_DAYS = 90
const UNDO = 6000

// The ring, drawn by hand: a circle whose stroke is dashed to the share of the
// day that has been consumed. No library, and nothing that moves.
const RADIUS = 42
const ROUND = 2 * Math.PI * RADIUS

// The sparkline's own box. Drawn in its own coordinates and scaled by the
// stylesheet, so it reads the same on a phone and on a desktop.
const SPARK_W = 240
const SPARK_H = 44
const SPARK_PAD = 4

function Ring({ consumed, budget }: { consumed: number; budget: number }) {
  const share = budget <= 0 ? 0 : Math.min(Math.max(consumed / budget, 0), 1)
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

// The trend as a line, with the readings themselves as light points around it.
function Spark({ trend, points }: {
  trend: { date: string; kg: number }[]
  points: Measurement[]
}) {
  if (trend.length < 2) return null
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
    y: SPARK_H - SPARK_PAD - ((kg - low) / range) * (SPARK_H - SPARK_PAD * 2),
  })

  const line = trend
    .map((row, index) => {
      const spot = at(days[index], row.kg)
      return `${index === 0 ? 'M' : 'L'}${spot.x.toFixed(1)} ${spot.y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="mt-3 h-11 w-full"
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
function CardHead({ label, onOpen, onAdd }: {
  label: string
  onOpen: () => void
  onAdd: () => void
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
      <button
        type="button"
        className="t-topbar-icon -mr-2"
        aria-label={`Add ${label.toLowerCase()}`}
        onClick={onAdd}
      >
        <Plus className="h-5 w-5" strokeWidth={2} />
      </button>
    </div>
  )
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

export function Dashboard({
  me,
  refresh,
  onOpenJournal,
  onOpenProfile,
}: {
  me: Me
  refresh: number
  // The Journal, on today. The Food and Exercise cards both lead there for
  // now; the Exercise one gets its own screen in a later round.
  onOpenJournal: () => void
  onOpenProfile: () => void
}) {
  const todayIso = today(me.timezone)
  const [day, setDay] = useState<DiaryDay | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [history, setHistory] = useState<Measurements | null>(null)
  const [error, setError] = useState('')
  const [again, setAgain] = useState(0)
  const [screen, setScreen] = useState<'measurements' | null>(null)
  const [picking, setPicking] = useState(false)
  const [measuring, setMeasuring] = useState<string | null>(null)
  const [exercising, setExercising] = useState(false)
  const [pending, setPending] = useState<Measurement | null>(null)
  const pendingRef = useRef<Measurement | null>(null)

  // The wordmark is the header here, and the rail's own name takes over
  // from it at the width the rail appears. The history is a sub-view, and it
  // names the way back.
  useTopBar(
    screen === 'measurements'
      ? { title: 'Measurements', back: { label: 'Dashboard', onBack: () => setScreen(null) } }
      : { title: 'Dashboard', left: 'wordmark' }
  )

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
    return () => {
      alive = false
    }
  }, [me.timezone, todayIso, refresh, again])

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

  if (screen === 'measurements') {
    return (
      <>
        {rows.length === 0 && (
          <div className="t-card mb-3">
            <p className="text-sm text-muted">No measurements yet.</p>
            <button
              type="button"
              className="t-btn t-btn-primary mt-3"
              onClick={() => setMeasuring(todayIso)}
            >
              Add measurements
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
        <CardHead label="Food" onOpen={onOpenJournal} onAdd={() => setPicking(true)} />
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <Ring
              consumed={day?.totals.calories ?? 0}
              budget={(day?.budget.calories ?? 0) + (day?.exercise_kcal ?? 0)}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="t-nums text-2xl font-semibold leading-none">
                {day === null ? '-' : day.remaining_calories}
              </span>
              <span className="text-xs text-muted">left</span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <span className="t-nums block text-sm">
              {day === null ? '-' : nutrientText('calories', day.totals.calories ?? 0)}
              <span className="text-muted"> consumed of {day?.budget.calories ?? '-'}</span>
            </span>
            {day !== null && day.exercise_kcal > 0 && (
              <span className="block text-xs text-muted">
                Exercise added back +{day.exercise_kcal}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
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

        {profile !== null && !profile.complete && (
          <button
            type="button"
            className="mt-3 text-sm text-accent"
            onClick={onOpenProfile}
          >
            Add your details for a personal number
          </button>
        )}
      </div>

      <div className="t-card mb-3">
        <CardHead
          label="Measurements"
          onOpen={() => setScreen('measurements')}
          onAdd={() => setMeasuring(todayIso)}
        />
        {latest === null ? (
          <p className="text-sm text-muted">No measurements yet.</p>
        ) : (
          <>
            <span className="t-nums block text-3xl font-semibold leading-tight">
              {weightText(latest.weight_kg, me.units)}
            </span>
            <span className="block text-xs text-muted">
              {dayLabel(latest.date, todayIso)}
              {trendKg === null ? '' : ` · your trend ${weightText(trendKg, me.units)}`}
            </span>
            <Spark trend={trend} points={spots} />
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
              Exercise added back +{day.exercise_kcal}
            </p>
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
