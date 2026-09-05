import { ChevronDown, ChevronRight, ChevronUp, Minus, StretchHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  api,
  errorText,
  type DailyMetric,
  type FitnessHistory,
  type FitnessHours,
  type FitnessSummary,
  type FitnessTrends,
  type HourMetric,
  type Me,
  type TrendRow,
  type Units,
  type Workout,
} from '../api'
import { ActivityIcon } from '../components/ActivityIcon'
import { HourBars } from '../components/HourBars'
import { WorkoutDetails } from '../components/WorkoutDetails'
import { useTopBar } from '../hooks/useTopBar'
import { stampText, useClock } from '../lib/clock'
import { dayLabel, today } from '../lib/day'
import { distanceIn, distanceUnit, durationText, round1 } from '../lib/units'
import { Moves } from './Moves'

// A figure and the word after it, kept apart so the word can be printed small
// beside a big number.
type Reading = { number: string; unit: string }

const whole = (value: number): string => Math.round(value).toLocaleString()

const readingText = (said: Reading): string =>
  said.unit === '' ? said.number : `${said.number} ${said.unit}`

// A distance in whatever the account reads in. Everything stored is metres,
// and a distance walked is read to the hundredth the way a watch prints it.
const distanceReading = (metres: number, units: Units): Reading => ({
  number: distanceIn(metres, units).toFixed(2),
  unit: distanceUnit(units),
})

// The three cards that carry a day by the hour: what each is called, which
// hourly series it draws, the colour it is drawn in, and how a figure of it
// reads. Tapping one opens its own history.
type Tile = {
  metric: DailyMetric
  label: string
  hours: HourMetric
  // What the chevron beside the title says it opens.
  aria: string
  // The colour the bars take and the class the number is printed in.
  colour: string
  tone: string
  read: (value: number, units: Units) => Reading
}

const TILES: Tile[] = [
  {
    metric: 'steps',
    label: 'Step Count',
    hours: 'steps',
    aria: 'Step count details',
    colour: 'var(--violet)',
    tone: 'text-violet',
    read: (value) => ({ number: whole(value), unit: '' }),
  },
  {
    metric: 'distance',
    label: 'Step Distance',
    hours: 'distance',
    aria: 'Step distance details',
    colour: 'var(--blue)',
    tone: 'text-blue',
    read: distanceReading,
  },
  {
    metric: 'active_kcal',
    label: 'Active Calories',
    hours: 'active_kcal',
    aria: 'Active calories details',
    colour: 'var(--orange)',
    tone: 'text-orange',
    read: (value) => ({ number: whole(value), unit: 'cal' }),
  },
]

// The word a card's figures are in, which is the same whatever the figure is.
const unitOf = (tile: Tile, units: Units): string => tile.read(0, units).unit

// What each trend row is called and the colour it is read in.
const TREND_LOOK: Record<TrendRow['key'], { label: string; tone: string }> = {
  steps: { label: 'Steps', tone: 'text-violet' },
  exercise_minutes: { label: 'Exercise', tone: 'text-accent' },
  distance: { label: 'Distance', tone: 'text-blue' },
  workouts: { label: 'Workouts', tone: 'text-orange' },
}

// The four trend rows before an answer has arrived, so the card is the same
// shape whether or not there is anything to say yet.
const NO_TRENDS: TrendRow[] = (Object.keys(TREND_LOOK) as TrendRow['key'][]).map((key) => ({
  key,
  recent: null,
  prior: null,
  unit: '',
  direction: null,
}))

// A card with nothing in it yet still draws its hours, so an empty chart reads
// as a quiet day rather than as a box that failed to load.
const NO_HOURS: (number | null)[] = Array(24).fill(null)

// What each tile's history is worth reading over.
const HISTORY_DAYS = 30

// Which of its own screens Fitness is on: a reading's history, one workout,
// the whole list of them, the stretches library, or the page itself.
type FitnessScreen =
  | { kind: 'metric'; metric: DailyMetric }
  | { kind: 'workout'; id: number }
  | { kind: 'workouts' }
  | { kind: 'moves' }
  | null

// Every hourly series the page has been answered for, by the tile it belongs
// to. A tile with no answer yet draws an empty day.
type HourSeries = Partial<Record<DailyMetric, (number | null)[]>>

// "Tue Sep 2", for the tooltip a pointer gets on a bar.
const dayTitle = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`)
    .toLocaleDateString(undefined, {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    .replace(',', '')

// A day's total out of its hours, or nothing when no hour has an answer.
function totalOf(hours: (number | null)[] | undefined): number | null {
  const known = (hours ?? []).filter((value): value is number => value !== null)
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0)
}

// Today's figure for one card. Distance is not one of the numbers a day's
// summary carries, so it is added up from its own hours.
function todayValue(tile: Tile, summary: FitnessSummary | null, hours: HourSeries) {
  if (tile.metric === 'distance') return totalOf(hours.distance)
  // A phone that has sent the hours but not yet the day's figure still has a
  // day's figure: the hours added up.
  return summary?.today[tile.metric] ?? totalOf(hours[tile.metric])
}

// One series in the unit the card prints it in: everything stored is metres.
const hoursIn = (
  tile: Tile,
  held: (number | null)[],
  units: Units
): (number | null)[] =>
  tile.metric === 'distance'
    ? held.map((value) => (value === null ? null : distanceIn(value, units)))
    : held

function MiniBars({
  values,
  label,
  // The day each column stands for, when the caller has them. Without them
  // there is nothing to name a bar by, so it gets no tooltip.
  dates,
  format,
}: {
  values: (number | null)[]
  label: string
  dates?: string[]
  format: (value: number) => string
}) {
  const highest = Math.max(...values.map((value) => value ?? 0), 1)
  const width = values.length * 8 - 2
  return (
    // Stretched to the card on a phone. On a wide card that turns the bars
    // into slabs, so the picture is capped and the rects read as bars again.
    <div className="mt-2 w-full min-[900px]:max-w-56">
      <svg
        viewBox={`0 0 ${width} 24`}
        className="h-6 w-full min-[900px]:h-8"
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <line
          className="t-stroke"
          x1={0}
          y1={23.5}
          x2={width}
          y2={23.5}
          stroke="var(--line)"
          strokeWidth={1}
        />
        {values.map((value, index) => {
          const height = value === null ? 1 : Math.max((value / highest) * 24, 1)
          const day = dates?.[index]
          return (
            <rect
              key={index}
              x={index * 8}
              y={24 - height}
              width={3}
              height={height}
              rx={1}
              className={value === null ? 'fill-surface-2' : 'fill-accent'}
            >
              {value !== null && day !== undefined && (
                <title>{`${dayTitle(day)}: ${format(value)}`}</title>
              )}
            </rect>
          )
        })}
      </svg>
    </div>
  )
}

// The head of every card on this page: its name, and the way into whatever it
// is a summary of.
function CardHead({
  title,
  aria,
  onOpen,
}: {
  title: string
  aria?: string
  onOpen?: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <p className="t-micro min-w-0 flex-1 truncate">{title}</p>
      {onOpen !== undefined && (
        <button type="button" className="t-tap44 shrink-0" aria-label={aria} onClick={onOpen}>
          <ChevronRight className="h-4 w-4 text-muted" strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

// One reading of the day: today's figure in its own colour, over the hours it
// was made in.
function HourCard({
  tile,
  units,
  value,
  hours,
  note,
  onOpen,
}: {
  tile: Tile
  units: Units
  value: number | null
  hours: (number | null)[]
  // One line under the number, for a card that has nothing to draw yet.
  note?: string
  onOpen: () => void
}) {
  const said = value === null ? null : tile.read(value, units)
  return (
    <div className="t-card">
      <CardHead title={tile.label} aria={tile.aria} onOpen={onOpen} />
      <p className="text-xs text-muted">Today</p>
      <p className={`t-nums text-2xl font-semibold ${tile.tone}`}>
        {said === null ? '-' : said.number}
        {said !== null && said.unit !== '' && (
          <span className="ml-1 text-xs">{said.unit}</span>
        )}
      </p>
      {note !== undefined && <p className="mb-1 text-xs text-muted">{note}</p>}
      <div className="mt-2">
        <HourBars
          hours={hours}
          color={tile.colour}
          label={`${tile.label}, by the hour`}
          unit={unitOf(tile, units)}
        />
      </div>
    </div>
  )
}

// The day's sessions, each as its own block rather than a list row: one
// session is the thing somebody came to see.
function SessionsCard({
  units,
  workouts,
  onOpen,
  onOpenAll,
}: {
  units: Units
  workouts: Workout[]
  onOpen: (id: number) => void
  onOpenAll: () => void
}) {
  return (
    <div className="t-card flex flex-col">
      <CardHead title="Sessions" aria="All workouts" onOpen={onOpenAll} />
      <div className="flex-1">
        {workouts.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No sessions today.</p>
        ) : (
          workouts.map((row) => {
            const said =
              row.distance_m === null
                ? { number: durationText(row.duration_s), unit: '' }
                : distanceReading(row.distance_m, units)
            return (
              <button
                key={row.id}
                type="button"
                className="mt-2 flex w-full items-center gap-2 text-left"
                onClick={() => onOpen(row.id)}
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)' }}
                >
                  <ActivityIcon name={row.activity} className="h-5 w-5 text-accent" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{row.activity}</span>
                  <span className="t-nums block truncate text-xl font-semibold text-accent">
                    {said.number}
                    {said.unit !== '' && <span className="ml-1 text-xs">{said.unit}</span>}
                  </span>
                </span>
              </button>
            )
          })
        )}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
        <span className="text-xs text-muted">Today</span>
        <span className="t-nums text-xs text-muted">{workouts.length}</span>
      </div>
    </div>
  )
}

// What one trend row says. Steps and minutes are whole numbers; a distance a
// day and sessions a week take one decimal.
function trendReading(row: TrendRow, units: Units): Reading | null {
  if (row.recent === null) return null
  if (row.key === 'distance') {
    return {
      number: round1(distanceIn(row.recent, units)).toLocaleString(),
      unit: `${distanceUnit(units)}/day`,
    }
  }
  if (row.key === 'workouts') {
    return { number: round1(row.recent).toLocaleString(), unit: row.unit }
  }
  return { number: whole(row.recent), unit: row.unit }
}

function TrendsCard({ rows, units }: { rows: TrendRow[]; units: Units }) {
  return (
    <div className="t-card mb-3">
      <CardHead title="Trends" />
      <div className="mt-2 grid grid-cols-2 gap-3">
        {rows.map((row) => {
          const look = TREND_LOOK[row.key]
          const said = row.direction === null ? null : trendReading(row, units)
          const Glyph =
            row.direction === 'up' ? ChevronUp : row.direction === 'down' ? ChevronDown : Minus
          const glyph =
            row.direction === 'up'
              ? 'text-accent'
              : row.direction === 'down'
                ? 'text-coral'
                : 'text-muted'
          return (
            <div key={row.key} className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2">
                <Glyph className={`h-5 w-5 ${glyph}`} strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{look.label}</span>
                {said === null ? (
                  <span className="block text-xs text-muted">Not enough data</span>
                ) : (
                  <span className={`t-nums block text-base font-semibold ${look.tone}`}>
                    {said.number}
                    <span className="ml-1 text-xs">{said.unit}</span>
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
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
                {row.distance_m === null
                  ? ''
                  : ` · ${readingText(distanceReading(row.distance_m, me.units))}`}
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
  metric: DailyMetric
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
    api<FitnessHours>(`/fitness/intraday?metric=${tile.hours}&date=${date}`)
      .then((row) => alive && setHours(row))
      .catch(() => alive && setHours(null))
    return () => {
      alive = false
    }
  }, [metric, date, tile.hours])

  const values = history?.days.map((row) => row.value) ?? []
  const dates = history?.days.map((row) => row.date) ?? []
  const known = values.filter((value): value is number => value !== null)
  const average = known.length === 0 ? null : known.reduce((a, b) => a + b, 0) / known.length
  const said = (value: number): string => readingText(tile.read(value, me.units))

  return (
    <>
      <div className="t-card mb-3">
        <p className="t-micro mb-2">Last {HISTORY_DAYS} days</p>
        {average === null ? (
          <p className="text-sm text-muted">Nothing has arrived for these days yet.</p>
        ) : (
          <>
            <p className="t-nums text-3xl">{said(average)}</p>
            <p className="text-sm text-muted">on an average day</p>
            <MiniBars
              values={values}
              dates={dates}
              format={said}
              label={`${tile.label}, last ${HISTORY_DAYS} days`}
            />
          </>
        )}
      </div>

      <div className="t-card mb-3">
        <p className="t-micro mb-2">{dayLabel(date, today(me.timezone))}, by the hour</p>
        <HourBars
          hours={hoursIn(tile, hours === null ? NO_HOURS : hours.hours, me.units)}
          color={tile.colour}
          label={`${tile.label}, by the hour`}
          unit={unitOf(tile, me.units)}
          tall
        />
      </div>
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
  // This screen names itself, because it holds screens of its own and each of
  // them is a level deeper than the list it was reached from.
  onBack: () => void
  // The wizard lives on its own screen under More, because it is the same
  // wizard whether somebody arrived here or went looking for it.
  onOpenSync: () => void
}) {
  const todayIso = today(me.timezone)
  const [summary, setSummary] = useState<FitnessSummary | null>(null)
  const [hours, setHours] = useState<HourSeries>({})
  const [trends, setTrends] = useState<TrendRow[]>(NO_TRENDS)
  const [failed, setFailed] = useState('')
  const [screen, setScreen] = useState<FitnessScreen>(null)
  // The sync line is a stamp, so it redraws when the clock changes.
  useClock()

  useEffect(() => {
    let alive = true
    api<FitnessSummary>(`/fitness/summary?date=${todayIso}`)
      .then((row) => alive && setSummary(row))
      .catch((failure) => alive && setFailed(errorText(failure)))
    api<FitnessTrends>(`/fitness/trends?date=${todayIso}`)
      .then((row) => alive && setTrends(row.rows))
      .catch(() => alive && setTrends(NO_TRENDS))
    for (const tile of TILES) {
      api<FitnessHours>(`/fitness/intraday?metric=${tile.hours}&date=${todayIso}`)
        .then((row) => alive && setHours((held) => ({ ...held, [tile.metric]: row.hours })))
        .catch(() => {})
    }
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
  if (screen !== null && screen.kind === 'workouts') {
    return (
      <AllWorkouts
        me={me}
        refresh={refresh}
        onBack={() => setScreen(null)}
        onOpen={(id) => setScreen({ kind: 'workout', id })}
      />
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

  const connected = summary !== null && summary.connected
  const [steps, distance, calories] = TILES
  const card = (tile: Tile, note?: string) => (
    <HourCard
      tile={tile}
      units={me.units}
      value={todayValue(tile, summary, hours)}
      hours={hoursIn(tile, hours[tile.metric] ?? NO_HOURS, me.units)}
      note={note}
      onOpen={() => setScreen({ kind: 'metric', metric: tile.metric })}
    />
  )

  return (
    <>
      {summary !== null && !connected && (
        <div className="t-card mb-3">
          <p className="text-sm">Not connected.</p>
          <p className="mt-1 text-sm text-muted">
            Connect your phone and Tare will fill this in on its own.
          </p>
          <button type="button" className="t-btn t-btn-primary mt-3" onClick={onOpenSync}>
            Sync a device
          </button>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3">
        {card(steps, connected ? undefined : 'Sync a device to see steps here.')}
        {card(distance)}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <SessionsCard
          units={me.units}
          workouts={summary?.workouts ?? []}
          onOpen={(id) => setScreen({ kind: 'workout', id })}
          onOpenAll={() => setScreen({ kind: 'workouts' })}
        />
        {card(calories)}
      </div>

      <TrendsCard rows={trends} units={me.units} />

      <button
        type="button"
        className="t-card mb-3 block w-full text-left"
        onClick={() => setScreen({ kind: 'moves' })}
      >
        <span className="t-section">
          <StretchHorizontal className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
          <span className="min-w-0 flex-1">Stretches & Bodyweight Exercises</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
        </span>
        <span className="mt-1 block text-sm text-muted">
          An index full of gentle stretches and bodyweight activities with detailed instructions.
        </span>
      </button>

      {connected && summary !== null && (
        <p className="t-note mb-3">
          Connected ·{' '}
          {summary.last_sync === null ? 'nothing has arrived yet' : stampText(summary.last_sync)} ·{' '}
          <button type="button" className="t-tap44 text-accent" onClick={onOpenSync}>
            Set up another device
          </button>
        </p>
      )}
    </>
  )
}

function AllWorkouts({
  me,
  refresh,
  onBack,
  onOpen,
}: {
  me: Me
  refresh: number
  onBack: () => void
  onOpen: (id: number) => void
}) {
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useTopBar({ title: 'All workouts', back: { label: 'Fitness', onBack } })

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
