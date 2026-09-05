import { ChevronRight, StretchHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  api,
  errorText,
  type FitnessHistory,
  type FitnessHours,
  type FitnessMetric,
  type FitnessSummary,
  type HourMetric,
  type Me,
  type Workout,
} from '../api'
import { ActivityIcon } from '../components/ActivityIcon'
import { WorkoutDetails } from '../components/WorkoutDetails'
import { useTopBar } from '../hooks/useTopBar'
import { stampText, useClock } from '../lib/clock'
import { dayLabel, today } from '../lib/day'
import { distanceText, durationText } from '../lib/units'
import { Moves } from './Moves'

// The four readings, in the order they are drawn, with the plain words for
// each and the unit each is read in. No formula names and no Apple words.
const TILES: {
  metric: FitnessMetric
  label: string
  unit: string
  // Which hour-by-hour series belongs under it, when one does.
  hours?: HourMetric
}[] = [
  { metric: 'steps', label: 'Steps', unit: '', hours: 'steps' },
  { metric: 'active_kcal', label: 'Active calories', unit: 'cal', hours: 'active_kcal' },
  { metric: 'exercise_minutes', label: 'Exercise minutes', unit: 'min' },
  { metric: 'resting_hr', label: 'Resting heart rate', unit: 'bpm', hours: 'hr' },
]

// What each tile's history is worth reading over.
const HISTORY_DAYS = 30

// Which of its own screens Fitness is on: a reading's history, one workout,
// the stretches library, or the list itself.
type FitnessScreen =
  | { kind: 'metric'; metric: FitnessMetric }
  | { kind: 'workout'; id: number }
  | { kind: 'moves' }
  | null

const whole = (value: number): string => Math.round(value).toLocaleString()

function figure(value: number | null, unit: string): string {
  if (value === null) return '-'
  return unit === '' ? whole(value) : `${whole(value)} ${unit}`
}

function MiniBars({ values, label }: { values: (number | null)[]; label: string }) {
  const highest = Math.max(...values.map((value) => value ?? 0), 1)
  return (
    <svg
      viewBox={`0 0 ${values.length * 8 - 2} 24`}
      className="mt-2 h-6 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {values.map((value, index) => {
        const height = value === null ? 1 : Math.max((value / highest) * 24, 1)
        return (
          <rect
            key={index}
            x={index * 8}
            y={24 - height}
            width={6}
            height={height}
            rx={1}
            className={value === null ? 'fill-surface-2' : 'fill-accent'}
          />
        )
      })}
    </svg>
  )
}

function HourBars({ hours }: { hours: (number | null)[] }) {
  const highest = Math.max(...hours.map((value) => value ?? 0), 1)
  return (
    <>
      <svg
        viewBox="0 0 288 60"
        className="h-16 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="By the hour, midnight to midnight"
      >
        {hours.map((value, hour) => {
          const height = value === null ? 1 : Math.max((value / highest) * 60, 1)
          return (
            <rect
              key={hour}
              x={hour * 12}
              y={60 - height}
              width={10}
              height={height}
              rx={1}
              className={value === null ? 'fill-surface-2' : 'fill-accent'}
            />
          )
        })}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>12 am</span>
        <span>Noon</span>
        <span>11 pm</span>
      </div>
    </>
  )
}

function WorkoutRows({
  me,
  workouts,
  onOpen,
}: {
  me: Me
  workouts: Workout[]
  onOpen: (id: number) => void
}) {
  const todayIso = today(me.timezone)
  return (
    <>
      {workouts.map((row) => (
        <button
          key={row.id}
          type="button"
          className="t-row w-full text-left"
          onClick={() => onOpen(row.id)}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <ActivityIcon name={row.activity} className="h-4 w-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{row.activity}</span>
              <span className="block text-xs text-muted">
                {dayLabel(row.date, todayIso)} · {durationText(row.duration_s)}
                {row.distance_m === null ? '' : ` · ${distanceText(row.distance_m, me.units)}`}
                {row.kcal === null ? '' : ` · about ${row.kcal} cal`}
              </span>
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
        </button>
      ))}
    </>
  )
}

function MetricDetail({
  me,
  metric,
  date,
  onBack,
}: {
  me: Me
  metric: FitnessMetric
  date: string
  onBack: () => void
}) {
  const tile = TILES.find((row) => row.metric === metric)!
  const [history, setHistory] = useState<FitnessHistory | null>(null)
  const [hours, setHours] = useState<FitnessHours | null>(null)

  useTopBar({ title: tile.label, back: { label: 'Fitness', onBack } })

  useEffect(() => {
    let alive = true
    api<FitnessHistory>(`/fitness/daily?metric=${metric}&days=${HISTORY_DAYS}&date=${date}`)
      .then((row) => alive && setHistory(row))
      .catch(() => alive && setHistory(null))
    if (tile.hours !== undefined) {
      api<FitnessHours>(`/fitness/intraday?metric=${tile.hours}&date=${date}`)
        .then((row) => alive && setHours(row))
        .catch(() => alive && setHours(null))
    }
    return () => {
      alive = false
    }
  }, [metric, date, tile.hours])

  const values = history?.days.map((row) => row.value) ?? []
  const known = values.filter((value): value is number => value !== null)
  const average = known.length === 0 ? null : known.reduce((a, b) => a + b, 0) / known.length

  return (
    <>
      <div className="t-card mb-3">
        <p className="t-micro mb-2">Last {HISTORY_DAYS} days</p>
        {known.length === 0 ? (
          <p className="text-sm text-muted">Nothing has arrived for these days yet.</p>
        ) : (
          <>
            <p className="t-nums text-3xl">{figure(average, tile.unit)}</p>
            <p className="text-sm text-muted">on an average day</p>
            <MiniBars values={values} label={`${tile.label}, last ${HISTORY_DAYS} days`} />
          </>
        )}
      </div>

      {hours !== null && (
        <div className="t-card mb-3">
          <p className="t-micro mb-2">{dayLabel(date, today(me.timezone))}, by the hour</p>
          <HourBars hours={hours.hours} />
        </div>
      )}
    </>
  )
}

export function Fitness({
  me,
  refresh,
  onBack,
  onOpenSync,
}: {
  me: Me
  // The app-wide change tick. A workout that arrived while this was open
  // belongs on the screen, and reading again leaves what is up alone.
  refresh: number
  // This screen names itself, because it holds two screens of its own and each
  // of them is a level deeper than the list it was reached from.
  onBack: () => void
  // The wizard lives on its own screen under More, because it is the same
  // wizard whether somebody arrived here or went looking for it.
  onOpenSync: () => void
}) {
  const todayIso = today(me.timezone)
  const [summary, setSummary] = useState<FitnessSummary | null>(null)
  const [failed, setFailed] = useState('')
  const [screen, setScreen] = useState<FitnessScreen>(null)
  // The sync line is a stamp, so it redraws when the clock changes.
  useClock()

  useEffect(() => {
    let alive = true
    api<FitnessSummary>(`/fitness/summary?date=${todayIso}`)
      .then((row) => alive && setSummary(row))
      .catch((failure) => alive && setFailed(errorText(failure)))
    return () => {
      alive = false
    }
  }, [todayIso, refresh])

  useTopBar(screen === null ? { title: 'Fitness', back: { label: 'More', onBack } } : null)

  if (screen !== null && screen.kind === 'moves') {
    return <Moves onBack={() => setScreen(null)} />
  }
  if (screen !== null && screen.kind === 'workout') {
    return (
      <WorkoutDetails me={me} workoutId={screen.id} onBack={() => setScreen(null)} />
    )
  }
  if (screen !== null && screen.kind === 'metric') {
    return (
      <MetricDetail
        me={me}
        metric={screen.metric}
        date={todayIso}
        onBack={() => setScreen(null)}
      />
    )
  }

  if (failed !== '') return <p className="t-error">{failed}</p>
  if (summary === null) return <p className="text-sm text-muted">Loading.</p>


  return (
    <>
      <div className="t-card mb-3">
        {summary.connected ? (
          <>
            <p className="text-sm">Connected</p>
            <p className="text-xs text-muted">
              Last health data sync:{' '}
              {summary.last_sync === null
                ? 'nothing has arrived yet'
                : stampText(summary.last_sync)}
            </p>
            <button
              type="button"
              className="t-tap44 mt-1 text-sm text-muted"
              onClick={onOpenSync}
            >
              Set up another device
            </button>
          </>
        ) : (
          <>
            <p className="text-sm">Not connected.</p>
            <p className="mt-1 text-sm text-muted">
              Connect your phone and Tare will fill this in on its own.
            </p>
            <button type="button" className="t-btn t-btn-primary mt-3" onClick={onOpenSync}>
              Sync a device
            </button>
          </>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        {TILES.map((tile) => (
          <button
            key={tile.metric}
            type="button"
            className="t-card text-left"
            onClick={() => setScreen({ kind: 'metric', metric: tile.metric })}
          >
            <p className="t-micro mb-1">{tile.label}</p>
            <p className="t-nums text-2xl">
              {figure(summary.today[tile.metric], tile.unit)}
            </p>
            <MiniBars
              values={summary.week.map((row) => row[tile.metric])}
              label={`${tile.label}, last seven days`}
            />
          </button>
        ))}
      </div>

      <div className="t-card mb-3">
        <p className="t-micro mb-1">Today's workouts</p>
        {summary.workouts.length === 0 ? (
          <p className="text-sm text-muted">Nothing logged today.</p>
        ) : (
          <WorkoutRows
            me={me}
            workouts={summary.workouts}
            onOpen={(id) => setScreen({ kind: 'workout', id })}
          />
        )}
      </div>

      <AllWorkouts
        me={me}
        refresh={refresh}
        onOpen={(id) => setScreen({ kind: 'workout', id })}
      />

      <button
        type="button"
        className="t-card mb-3 block w-full text-left"
        onClick={() => setScreen({ kind: 'moves' })}
      >
        <span className="t-section">
          <StretchHorizontal className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
          <span className="min-w-0 flex-1">Stretches and moves</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
        </span>
        <span className="mt-1 block text-sm text-muted">
          Gentle stretches and bodyweight moves, with the steps for each.
        </span>
      </button>
    </>
  )
}

function AllWorkouts({
  me,
  refresh,
  onOpen,
}: {
  me: Me
  refresh: number
  onOpen: (id: number) => void
}) {
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    api<{ workouts: Workout[]; cursor: number | null }>('/fitness/workouts')
      .then((page) => {
        if (!alive) return
        setWorkouts(page.workouts)
        setCursor(page.cursor)
        setLoaded(true)
      })
      .catch(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [refresh])

  const more = async () => {
    if (cursor === null) return
    const page = await api<{ workouts: Workout[]; cursor: number | null }>(
      `/fitness/workouts?cursor=${cursor}`
    )
    setWorkouts((rows) => [...rows, ...page.workouts])
    setCursor(page.cursor)
  }

  if (!loaded) return null

  return (
    <div className="t-card mb-3">
      <p className="t-micro mb-1">All workouts</p>
      {workouts.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing here yet: workouts appear once your phone sends them.
        </p>
      ) : (
        <>
          <WorkoutRows me={me} workouts={workouts} onOpen={onOpen} />
          {cursor !== null && (
            <button type="button" className="t-btn mt-3 w-full" onClick={more}>
              Show more
            </button>
          )}
        </>
      )}
    </div>
  )
}
