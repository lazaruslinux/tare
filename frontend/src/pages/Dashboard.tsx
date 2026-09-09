import { ChevronRight, CircleCheck, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'

import {
  api,
  errorText,
  type DayRow,
  type DayWorkout,
  type DiaryDay,
  type DiaryDays,
  type FitnessDay,
  type FitnessDays,
  type FitnessSummary,
  type Me,
  type Measurement,
  type Measurements,
  type Profile as HealthProfile,
  type ShareKey,
  type SharePoint,
  type Stamp,
  type Targets,
  type TrendPoint,
} from '../api'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { barsAverage, DayBars, weekly, type Bar } from '../components/DayBars'
import { ExerciseSheet } from '../components/ExerciseSheet'
import { FoodPicker } from '../components/FoodPicker'
import { GoalSheet } from '../components/GoalSheet'
import { MeasurementsSheet } from '../components/MeasurementsSheet'
import { Feed } from '../components/Feed'
import { MemberView } from '../components/MemberView'
import { WorkoutDetails } from '../components/WorkoutDetails'
import { useTopBar } from '../hooks/useTopBar'
import { useWideLayout } from '../hooks/useWideLayout'
import { dateText as stampDate } from '../lib/clock'
import { dayLabel, shiftDay, slotByTime, today, weekday } from '../lib/day'
import { calText, dateText } from '../lib/targets'
import {
  distanceIn,
  distanceUnit,
  elapsedText,
  round1,
  weightIn,
  weightText,
  weightUnit,
} from '../lib/units'

// How far back the newest of each measured number is looked for.
const HISTORY_DAYS = 90

// The week, and how many days the Progress screen shows. Both come from the
// one request, because a month of days is a few hundred bytes.
const WEEK = 7
const RUN_DAYS = 28

// The four spans one switch reads every card over, what each is called, and
// how a change of weight across it is said. The screen always opens on the
// week; a longer span is asked for and lasts as long as the visit.
// The weight line never reads less than a month: a week holds one weigh-in
// for most people, and one point is not a trend. Food and steps keep the week.
const WEIGHT_FLOOR = 30

const SPANS = [
  { days: WEEK, label: 'This week', over: 'over 30 days' },
  { days: 30, label: '30 days', over: 'over 30 days' },
  { days: 90, label: '3 months', over: 'over 3 months' },
  { days: 180, label: '6 months', over: 'over 6 months' },
]

// Which lines the chart draws, remembered on the device. Every measured
// number can have one: the weight in the accent green, the body fat in the
// pending amber, and three tokens of their own for the rest.
type LineKey = 'weight' | ShareKey
type Lines = Record<LineKey, boolean>
const LINES_KEY = 'tare.progress.lines'

// What each line is called on its chip, the word the change sentence names it
// with so two percentages cannot be read as one another, the reading it is
// drawn from, and the colour it and its chip wear.
const LINE_SPECS: {
  key: LineKey
  label: string
  word: string
  field: 'weight_kg' | 'body_fat_pct' | 'body_water_pct' | 'muscle_pct'
  colour: string
}[] = [
  { key: 'weight', label: 'Weight', word: '', field: 'weight_kg', colour: 'var(--accent)' },
  { key: 'fat', label: 'Body fat', word: 'fat', field: 'body_fat_pct', colour: 'var(--pending)' },
  {
    key: 'water',
    label: 'Body water',
    word: 'water',
    field: 'body_water_pct',
    colour: 'var(--chart-water)',
  },
  {
    key: 'muscle',
    label: 'Muscle',
    word: 'muscle',
    field: 'muscle_pct',
    colour: 'var(--violet)',
  },
]

// The two that were on before any of this was a choice.
const DEFAULT_LINES: Lines = {
  weight: true,
  fat: true,
  water: false,
  muscle: false,
}

// Nothing measured yet, so every line has nothing to draw.
const NO_TRENDS: Record<ShareKey, SharePoint[]> = { fat: [], water: [], muscle: [] }

function readLines(): Lines {
  try {
    const raw = localStorage.getItem(LINES_KEY)
    if (raw === null) return DEFAULT_LINES
    const on = raw.split(',')
    const kept = Object.fromEntries(
      LINE_SPECS.map((spec) => [spec.key, on.includes(spec.key)]),
    ) as Lines
    // Nothing on is not a chart, so a key that says so is not believed.
    return LINE_SPECS.some((spec) => kept[spec.key]) ? kept : DEFAULT_LINES
  } catch {
    return DEFAULT_LINES
  }
}

// Past this many columns a run is drawn a bar a week rather than a bar a day:
// thirty still land on a phone, three months of them do not.
const DAILY_MAX = 30

// How many weekly bars can carry their number over them on a wide card.
const MAX_LABELS = 14

// The ring, drawn by hand: a circle whose stroke is dashed to the share of the
// day that has been consumed. No library, and nothing that moves.
const RADIUS = 45
const ROUND = 2 * Math.PI * RADIUS

// What one ring is filled to, what stands in its middle, the words under that,
// what a screen reader is told, and where tapping it goes. `wide` marks the
// three that only a wide card has room for.
type RingSpec = {
  key: string
  filled: number
  centre: string
  caption: string
  label: string
  color: string
  onOpen: () => void
  wide?: boolean
}

function Ring({ filled, color }: { filled: number; color: string }) {
  const share = Math.min(Math.max(filled, 0), 1)
  return (
    // As wide as the column it stands in, so the room a screen has is the room
    // the ring takes.
    <svg viewBox="0 0 100 100" className="h-auto w-full -rotate-90" aria-hidden="true">
      <circle
        cx="50"
        cy="50"
        r={RADIUS}
        fill="none"
        stroke="var(--track)"
        strokeWidth="8"
      />
      <circle
        cx="50"
        cy="50"
        r={RADIUS}
        fill="none"
        stroke={color}
        strokeWidth="8"
        // A round cap on nothing is still a dot, and a ring with no answer in
        // it has to read as empty.
        strokeLinecap={share === 0 ? 'butt' : 'round'}
        strokeDasharray={`${share * ROUND} ${ROUND}`}
      />
    </svg>
  )
}

// A row of them, side by side and the same size. Each ring takes an even share
// of the row up to 112px, so a wider phone draws a wider ring instead of
// leaving the room unused. A wide card holds six, one to a column, and each one
// is its own way into what it counts.
function Rings({ rings }: { rings: RingSpec[] }) {
  return (
    // Spread across a phone, six even columns on a wide card.
    <div className="flex items-center justify-between gap-2 min-[900px]:grid min-[900px]:grid-cols-6 min-[900px]:gap-0">
      {rings.map((ring) => (
        <button
          key={ring.key}
          type="button"
          className={`t-ring relative min-w-0 max-w-28 flex-1 hover:opacity-90 min-[900px]:mx-auto min-[900px]:w-full ${
            ring.wide === true ? 'hidden min-[900px]:block' : ''
          }`}
          aria-label={ring.label}
          onClick={ring.onOpen}
        >
          <Ring filled={ring.filled} color={ring.color} />
          <div className="absolute inset-0 flex flex-col items-center justify-center px-1">
            <span
              // Five digits and a comma is the widest number a ring holds. At
              // the sizes a phone and a narrow column draw, that only fits one
              // size down, so long values step and short ones stay alike.
              className={`t-nums font-semibold leading-none ${
                ring.centre.length >= 6
                  ? 'text-lg min-[900px]:text-base'
                  : 'text-xl min-[900px]:text-lg'
              }`}
            >
              {ring.centre}
            </span>
            <span className="max-w-[4rem] text-center text-[10px] leading-tight text-muted">
              {ring.caption}
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}

// Steps over a bar, short enough to sit in a narrow column.
const stepsLabel = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value))

// A date as "Aug 31", for the span a week is named by.
const monthDay = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  })

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

// One line on the chart: what it is, the readings it joins, and the colour it
// is drawn in.
type Line = { key: string; points: { date: string; value: number }[]; colour: string }

// The readings, joined by straight lines, each one a round dot. Percent
// coordinates keep the dots round at any card width, since nothing here is
// scaled. Each line is scaled to its own low and high, because a weight and a
// percentage share only their dates; the axis gives the lines a ground and
// their dots dates.
function Spark({ series, tall, axis, selected = null, onSelect }: {
  series: Line[]
  tall?: boolean
  axis?: boolean
  // Which day the reader is on, and how that is said upward. Keyed by the day
  // itself rather than by a position, because the lines do not share one.
  selected?: string | null
  onSelect?: (date: string | null) => void
}) {
  const inset = 6
  const pick = onSelect !== undefined
  // The same three the bars keep, for the same reasons: what a gesture settled
  // on, where it began, and whether it moved off.
  const pinned = useRef<string | null>(selected)
  const from = useRef<string | null>(null)
  const dragged = useRef(false)
  const box = useRef<SVGSVGElement>(null)
  if (selected === null) pinned.current = null
  // A single reading is a dot, not a line, so it is left out of both the
  // drawing and the dates under it.
  const drawn = series
    .map((one) => ({
      ...one,
      points: [...one.points].sort((a, b) => (a.date < b.date ? -1 : 1)),
    }))
    .filter((one) => one.points.length > 1)
  if (drawn.length === 0) return null
  const dates = [...new Set(drawn.flatMap((one) => one.points.map((row) => row.date)))].sort()
  const first = Date.parse(`${dates[0]}T00:00:00Z`)
  const span = Math.max(Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - first, 1)
  const across = (date: string) =>
    inset + ((Date.parse(`${date}T00:00:00Z`) - first) / span) * (100 - inset * 2)
  const placed = drawn.map((one) => {
    const values = one.points.map((row) => row.value)
    const low = Math.min(...values)
    // A flat run must not divide by nothing, and it should sit in the middle.
    const range = Math.max(...values) - low || 1
    return {
      key: one.key,
      colour: one.colour,
      spots: one.points.map((row) => ({
        date: row.date,
        x: across(row.date),
        y: 100 - inset - ((row.value - low) / range) * (100 - inset * 2),
      })),
    }
  })
  const dated = axis === true ? ticked(dates.length) : []

  // The nearest reading to where the pointer is, across every line's days.
  const at = (event: PointerEvent<SVGSVGElement>): string | null => {
    const rect = box.current?.getBoundingClientRect()
    if (rect === undefined || rect.width <= 0) return null
    const part = ((event.clientX - rect.left) / rect.width) * 100
    let closest = dates[0]
    for (const date of dates) {
      if (Math.abs(across(date) - part) < Math.abs(across(closest) - part)) closest = date
    }
    return closest
  }

  const down = (event: PointerEvent<SVGSVGElement>) => {
    const date = at(event)
    if (date === null) return
    // Capture, so a drag off the edge keeps reading rather than handing the
    // drag back to the page. A pointer the browser is not tracking cannot be
    // captured, and the reading does not need it.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Nothing to hold on to.
    }
    from.current = pinned.current === date ? date : null
    dragged.current = false
    pinned.current = date
    onSelect?.(date)
  }

  const move = (event: PointerEvent<SVGSVGElement>) => {
    const date = at(event)
    if (date === null) return
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      onSelect?.(date)
      return
    }
    if (date !== pinned.current) dragged.current = true
    pinned.current = date
    onSelect?.(date)
  }

  const up = () => {
    if (from.current !== null && !dragged.current) {
      pinned.current = null
      onSelect?.(null)
    }
    from.current = null
  }

  const away = () => onSelect?.(pinned.current)

  const line = (
    <svg
      className={`w-full ${tall ? 'h-22' : 'h-11'}${pick ? ' touch-pan-y select-none' : ''}`}
      aria-hidden={pick ? undefined : true}
      role={pick ? 'group' : undefined}
      aria-label={pick ? 'Readings' : undefined}
      ref={box}
      onPointerDown={pick ? down : undefined}
      onPointerMove={pick ? move : undefined}
      onPointerUp={pick ? up : undefined}
      onPointerLeave={pick ? away : undefined}
      onPointerCancel={pick ? away : undefined}
    >
      {/* A rule at every dated tick, behind the lines, so a dot can be read
          back down to the date under it. The axis-less variant has no ticks
          and so gets none. */}
      {dated.map((index) => (
        <line
          key={`grid-${dates[index]}`}
          x1={`${across(dates[index])}%`}
          y1="0"
          x2={`${across(dates[index])}%`}
          y2="100%"
          stroke="var(--line-strong)"
          strokeWidth="1"
        />
      ))}
      {/* Where the reader is, straight down through every line at once. */}
      {selected !== null && dates.includes(selected) && (
        <line
          x1={`${across(selected)}%`}
          y1="0"
          x2={`${across(selected)}%`}
          y2="100%"
          stroke="var(--text)"
          strokeWidth="1"
        />
      )}
      {placed.map((one) => (
        <g key={one.key}>
          {one.spots.slice(1).map((spot, index) => (
            <line
              key={spot.date}
              x1={`${one.spots[index].x}%`}
              y1={`${one.spots[index].y}%`}
              x2={`${spot.x}%`}
              y2={`${spot.y}%`}
              stroke={one.colour}
              strokeWidth="2"
              strokeLinecap="round"
            />
          ))}
          {one.spots.map((spot) => (
            <circle
              key={spot.date}
              cx={`${spot.x}%`}
              cy={`${spot.y}%`}
              r={spot.date === selected ? 5 : 3.5}
              fill={one.colour}
              // The rest step back while one day is being read.
              opacity={selected !== null && spot.date !== selected ? 0.55 : undefined}
            />
          ))}
        </g>
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
        {dates.map((date) => (
          <span
            key={date}
            className="absolute top-0 h-1 w-px bg-line-strong"
            style={{ left: `${across(date)}%` }}
          />
        ))}
        {/* The row keeps its height whether or not a date sits in it, so the
            card does not jump when the readings change. */}
        <div className="relative h-4">
          {dated.map((index) => (
            <span
              key={dates[index]}
              className="absolute top-0.5 text-[10px] leading-none text-muted"
              style={
                index === dated[0]
                  ? { left: 0 }
                  : index === dated[dated.length - 1]
                    ? { right: 0 }
                    : { left: `${across(dates[index])}%`, transform: 'translateX(-50%)' }
              }
            >
              {tickText(dates[index])}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// The lines the chart can draw, each chip in its own line's colour. Five of
// them wrap onto a second row on a phone. Turning off the last one is
// ignored: an empty chart says nothing.
function LineChips({ lines, onPick }: { lines: Lines; onPick: (next: Lines) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {LINE_SPECS.map((spec) => (
        <button
          key={spec.key}
          type="button"
          aria-pressed={lines[spec.key]}
          className="t-chip"
          // The colours are chart tokens rather than palette ones, so a chip
          // wears its line's colour directly.
          style={lines[spec.key] ? { borderColor: spec.colour, color: spec.colour } : undefined}
          onClick={() => {
            const next = { ...lines, [spec.key]: !lines[spec.key] }
            if (LINE_SPECS.some((one) => next[one.key])) onPick(next)
          }}
        >
          {spec.label}
        </button>
      ))}
    </div>
  )
}

// What a point with nothing behind it says.
const NOTHING = 'No data for this selection'

// One point read off a chart, standing where the card's own headline stands
// and taking its place while something is chosen: a few parts joined by a dot,
// a tick for a day that was closed, and a way into the day itself.
function PointReadout({ parts, done, onOpen, className = '' }: {
  parts: string[]
  done?: boolean
  onOpen?: () => void
  className?: string
}) {
  return (
    <p className={`t-nums min-h-4 text-xs text-muted ${className}`} role="status">
      {/* A part stays whole when the line wraps: the spaces inside one are the
          kind that do not break, so a wrap only ever falls between parts. */}
      {parts.map((part) => part.replace(/ /g, ' ')).join(' · ')}
      {done === true && (
        <CircleCheck
          className="ml-1 inline h-3.5 w-3.5 align-text-bottom text-accent"
          aria-label="Journal complete"
        />
      )}
      {onOpen !== undefined && (
        <>
          {' · '}
          <button type="button" className="t-link" onClick={onOpen}>
            Open
          </button>
        </>
      )}
    </p>
  )
}

// Every card wears the same head: the category, which is a way into it, and a
// plus that adds to it.
// A count of days with its name under it, the way the rings say their number
// first and what it is second.
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="t-nums text-lg font-semibold leading-tight tracking-tight">{value}</p>
      <p className="t-micro">{label}</p>
    </div>
  )
}

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

// How far one line has moved across a window. Under a tenth is not a change
// anybody can act on, and a line with one reading has not moved at all.
function moveText(points: number[], unit: string): string {
  if (points.length < 2) return ''
  const moved = points[points.length - 1] - points[0]
  const size = round1(Math.abs(moved))
  return size < 0.1 ? '' : `${moved < 0 ? '−' : '+'}${size}${unit}`
}

// What the lines on the chart have done, weight first and bare, every share
// named by its word, and the window said once at the end. A line that is off,
// flat or too short says nothing, and a sentence with nothing in it is the one
// that says so.
function changeText(
  weight: TrendPoint[],
  shares: Record<ShareKey, SharePoint[]>,
  units: Me['units'],
  over: string,
  lines: Lines,
): string {
  const parts = LINE_SPECS.filter((spec) => lines[spec.key])
    .map((spec) => {
      if (spec.key === 'weight') {
        return moveText(weight.map((row) => weightIn(row.kg, units)), ` ${weightUnit(units)}`)
      }
      const moved = moveText(shares[spec.key].map((row) => row.pct), '%')
      return moved === '' ? '' : `${spec.word} ${moved}`
    })
    .filter((part) => part !== '')
  return parts.length === 0 ? `No change ${over}` : `${parts.join(' · ')} ${over}`
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
        {row.weight_kg !== null && (
          <div className="t-row min-h-9 text-sm">
            <span className="flex-1 text-muted">Weight</span>
            <span className="t-nums">{weightText(row.weight_kg, units)}</span>
          </div>
        )}
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
        {row.muscle_pct !== null && (
          <div className="t-row min-h-9 text-sm">
            <span className="flex-1 text-muted">Muscle</span>
            {/* A share read on a day with no weight has no mass to stand
                beside it, so the share is the whole row. */}
            <span className="t-nums">
              {round1(row.muscle_pct)}%
              {row.muscle_kg !== null && ` · ${weightText(row.muscle_kg, units)}`}
            </span>
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
  onOpenJournalDay,
  onOpenFitnessDay,
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
  // The same two, on the day a readout is about rather than on today.
  onOpenJournalDay: (date: string) => void
  onOpenFitnessDay: (date: string) => void
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
  const [history, setHistory] = useState<Measurements | null>(null)
  const [run, setRun] = useState<DayRow[]>([])
  const [targets, setTargets] = useState<Targets | null>(null)
  // What a phone sent for today. Null until it answers, and the strip it draws
  // appears only once a device is connected.
  const [fitness, setFitness] = useState<FitnessSummary | null>(null)
  // Worked out on the server from the latest weight and the height; shown
  // on Progress, where the weight it comes from lives.
  const [bmi, setBmi] = useState<number | null>(null)
  // The span every card is read over, and the weight line for it, which is its
  // own request: a trend over six months is not a trend over a month cut short.
  const [span, setSpan] = useState(WEEK)
  const [lines, setLines] = useState<Lines>(readLines)
  const [windowed, setWindowed] = useState<Measurements | null>(null)
  // The whole span a day at a time: what was walked, worked and burned, and
  // the sessions on each day. One request, whatever the span is.
  const [fitDays, setFitDays] = useState<FitnessDay[]>([])
  // Which point on each card the reader is on. A card with nothing chosen
  // shows its own headline.
  const [foodPick, setFoodPick] = useState<number | null>(null)
  const [movePick, setMovePick] = useState<number | null>(null)
  const [weighPick, setWeighPick] = useState<string | null>(null)
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
  // Whether that sheet opens straight on the weigh-in form, which is what the
  // Progress screen's own button asks for.
  const [weighing, setWeighing] = useState(false)
  const [exercising, setExercising] = useState(false)
  // Whether today's own step and exercise goals are open, which is what the
  // two rings they fill lead to.
  const [goaling, setGoaling] = useState(false)
  // The day's readings waiting on the question about deleting them.
  const [asking, setAsking] = useState<Measurement | null>(null)

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
    api<Measurements>(`/health/measurements?days=${HISTORY_DAYS}`)
      .then((loaded) => alive && setHistory(loaded))
      .catch(() => undefined)
    api<Targets>('/health/targets')
      .then((loaded) => alive && setTargets(loaded))
      .catch(() => undefined)
    api<FitnessSummary>(`/fitness/summary?date=${todayIso}`)
      .then((loaded) => alive && setFitness(loaded))
      .catch(() => undefined)
    api<HealthProfile>('/health/profile')
      .then((loaded) => alive && setBmi(loaded.bmi))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [me.timezone, todayIso, refresh, again])

  // One request a span, for every card that reads a run of days. The Progress
  // screen's own twenty-eight days are the tail of the same answer.
  useEffect(() => {
    let alive = true
    api<DiaryDays>(`/diary/days?days=${Math.max(RUN_DAYS, span)}`)
      .then((loaded) => alive && setRun(loaded.days))
      .catch(() => undefined)
    api<Measurements>(`/health/measurements?days=${Math.max(span, WEIGHT_FLOOR)}`)
      .then((loaded) => alive && setWindowed(loaded))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [todayIso, span, refresh, again])

  useEffect(() => {
    let alive = true
    api<FitnessDays>(`/fitness/days?days=${span}`)
      .then((loaded) => alive && setFitDays(loaded.days))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [todayIso, span, refresh, again])

  // A different span is a different set of columns, so whatever was being read
  // on the old one is not a point on the new one. A refresh is the same story.
  useEffect(() => {
    setFoodPick(null)
    setMovePick(null)
    setWeighPick(null)
  }, [span, refresh])

  const pickLines = (next: Lines) => {
    setLines(next)
    const on = LINE_SPECS.filter((spec) => next[spec.key]).map((spec) => spec.key)
    try {
      window.localStorage.setItem(LINES_KEY, on.join(','))
    } catch {
      // A browser that refuses storage still gets the lines it picked.
    }
  }

  const reload = () => {
    setPicking(false)
    setMeasuring(null)
    setWeighing(false)
    setExercising(false)
    setGoaling(false)
    setAgain(again + 1)
  }

  // The sheet on a day, with every form in it. What the history rows open.
  const openMeasurements = (date: string) => {
    setWeighing(false)
    setMeasuring(date)
  }

  // The same sheet on today, straight on the weight.
  const openWeighIn = () => {
    setWeighing(true)
    setMeasuring(todayIso)
  }

  const closeMeasurements = () => {
    setMeasuring(null)
    setWeighing(false)
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
    api(`/health/measurements/${row.date}`, { method: 'DELETE' }).catch(() => {
      // The row is already off the screen, and the next read tells the truth.
    })
  }

  const rows = history?.measurements ?? []
  const latest = rows[0] ?? null
  // Each number's own newest reading, so the card can say how old it is.
  const stamps = history?.latest ?? null
  // The newest weight on record, which the card leads with.
  const weighed = stamps?.weight_kg ?? null
  // Whether the card has any of them to show, which is what the rule above
  // them is for.
  const scaleRows =
    stamps !== null &&
    [
      stamps.body_fat_pct,
      stamps.body_water_pct,
      stamps.muscle_pct,
    ].some((one) => one !== null)
  // The weight over the chosen span, which this card and the Progress screen
  // both draw, and how a move across it is said.
  const chosen = SPANS.find((row) => row.days === span) ?? SPANS[0]
  const line = windowed?.trend ?? []
  const shares = windowed?.trends ?? NO_TRENDS
  const recorded = windowed?.measurements ?? []
  // The chart draws the readings themselves and the sentence reads the trend
  // under them, which is how the weight line has always worked.
  const chart: Line[] = LINE_SPECS.filter((spec) => lines[spec.key]).map((spec) => ({
    key: spec.key,
    colour: spec.colour,
    points: recorded.flatMap((row) => {
      const value = row[spec.field]
      return value === null ? [] : [{ date: row.date, value }]
    }),
  }))
  // Any one line is enough to be worth drawing.
  const trending =
    line.length > 1 || Object.values(shares).some((one) => one.length > 1)

  // The month the goal is reached at, said once and shown wherever the weight
  // is. Nothing at all without a goal weight.
  const goalMonth =
    targets === null || targets.projection === null
      ? ''
      : ` · Goal ${dateText(targets.projection.date)}`
  // The week somebody is standing in, Monday first, the way a week is read.
  // Sunday closes the week that began six days ago rather than opening one.
  const isWeek = span === WEEK
  const elapsed = ((weekday(todayIso) + 6) % 7) + 1
  const mondayIso = shiftDay(todayIso, -(elapsed - 1))
  // The days the cards are read over. The week is the whole frame, Monday to
  // Sunday, with the days still to come drawn as gaps, so the letters read as
  // the week and not as however far into it the member is. A longer span is a
  // run of days ending today.
  const dates = isWeek
    ? Array.from({ length: WEEK }, (_, index) => shiftDay(mondayIso, index))
    : Array.from({ length: span }, (_, index) => shiftDay(todayIso, index - span + 1))
  const inSpan = run.filter((row) => row.date >= dates[0])
  // Whether the span is drawn a bar a week rather than a bar a day.
  const weeks = dates.length > DAILY_MAX
  // What today is read against, which is what a day nobody has reached yet and
  // a whole week of them are drawn against as well.
  const budget = run.length === 0 ? 0 : run[run.length - 1].budget

  // The span as one picture: what was eaten against the day's number, and the
  // line under it. The bars and the sentences above them read the same rows,
  // and the counts and the average stay in days however the bars are grouped.
  const daily: Bar[] = dates.map((date) => {
    const row = inSpan.find((one) => one.date === date)
    return row === undefined
      ? { date, value: 0, target: budget, has: false }
      : { date, value: row.calories, target: row.budget, has: row.logged }
  })
  const intake = weeks ? weekly(daily) : daily
  const logged = inSpan.filter((row) => row.logged)
  const underTarget = logged.filter((row) => row.calories <= row.budget).length
  const completedDays = inSpan.filter((row) => row.completed).length
  const intakeFooter =
    logged.length === 0
      ? 'Log a few days to see them here.'
      : `Average ${calText(barsAverage(daily))} cal a day · budget ${calText(budget)}`
  // Over the bars on a wide card, where there are few enough of them to read.
  const labelled = weeks ? intake.length <= MAX_LABELS : isWeek

  // The same span in steps, when a phone is sending them. The goal is today's
  // own, which is the usual one unless today was set apart, so it is read off
  // the fitness answer rather than off the profile behind it.
  const stepGoal = fitness?.goals.steps ?? 0
  // Aligned by date rather than by position: the week is Monday to Sunday and
  // the run ends today, so the two do not line up on their own. A day the run
  // does not carry is a gap, which is what the rest of the week is. Each bar is
  // read against its own day's goal rather than against today's.
  const stepDaily: Bar[] = dates.map((date) => {
    const row = fitDays.find((one) => one.date === date)
    return {
      date,
      value: row?.steps ?? 0,
      target: row?.step_goal ?? stepGoal,
      has: row !== undefined && row.steps !== null,
    }
  })
  const stepBars = weeks ? weekly(stepDaily) : stepDaily
  const goalMet = stepDaily.filter((row) => row.has && row.value >= row.target).length
  const stepsFooter =
    stepDaily.every((row) => !row.has)
      ? 'Sync a few days to see them here.'
      : `Average ${calText(barsAverage(stepDaily))} steps a day · goal ${calText(stepGoal)}`
  // The summary counts the week and only the week, so the line is the week's.
  const sessions = fitness?.week_workouts ?? 0
  const sessionsLine =
    sessions === 0 ? 'No workouts' : sessions === 1 ? '1 workout' : `${sessions} workouts`
  const movedDays = inSpan.filter((row) => row.exercise_kcal > 0).length

  // ---- What a chosen column says.

  // A column is a day or a week, and a week is named by the Monday it starts
  // on. Either way it is the date on the bar that was tapped.
  const columnDate = (bars: Bar[], index: number | null): string | null =>
    index === null ? null : (bars[index]?.date ?? null)

  const macroParts = (protein: number, carbs: number, fat: number): string[] => [
    `${Math.round(protein)} g protein`,
    `${Math.round(carbs)} g carbs`,
    `${Math.round(fat)} g fat`,
  ]

  // The rows of one week that are also inside the span, which is what a part
  // week at either end of a run is made of.
  const weekRows = <T extends { date: string }>(rows: T[], monday: string): T[] => {
    const last = shiftDay(monday, 6)
    return rows.filter((row) => row.date >= monday && row.date <= last)
  }

  const mean = (values: number[]): number =>
    values.reduce((sum, one) => sum + one, 0) / values.length

  type Readout = { parts: string[]; done?: boolean; open?: boolean }

  const foodDayRead = (date: string): Readout => {
    const row = run.find((one) => one.date === date)
    if (row === undefined || !row.logged) return { parts: [NOTHING] }
    return {
      parts: [
        stampDate(date),
        `${calText(row.calories)} cal`,
        ...macroParts(row.protein_g, row.carbs_g, row.fat_g),
      ],
      done: row.completed,
      open: true,
    }
  }

  const foodWeekRead = (monday: string): Readout => {
    const week = weekRows(inSpan, monday)
    const kept = week.filter((row) => row.logged)
    if (kept.length === 0) return { parts: [NOTHING] }
    return {
      parts: [
        `Week of ${monthDay(monday)}`,
        `${calText(mean(kept.map((row) => row.calories)))} calories/day avg`,
        ...macroParts(
          mean(kept.map((row) => row.protein_g)),
          mean(kept.map((row) => row.carbs_g)),
          mean(kept.map((row) => row.fat_g))
        ),
      ],
      done: week.every((row) => row.completed),
    }
  }

  // One session, as the feed prints it: what it was, how far, and how long.
  const workoutPart = (row: DayWorkout): string =>
    row.distance_m === null
      ? `${row.activity} ${elapsedText(row.duration_s)}`
      : `${row.activity} ${distanceIn(row.distance_m, me.units).toFixed(2)} ${distanceUnit(
          me.units
        )} ${elapsedText(row.duration_s)}`

  const moveDayRead = (date: string): Readout => {
    const row = fitDays.find((one) => one.date === date)
    const said: string[] = []
    if (row !== undefined) {
      // A figure no phone ever sent is left out rather than read as a zero.
      if (row.steps !== null) said.push(`${calText(row.steps)} steps`)
      if (row.exercise_minutes !== null) said.push(`${Math.round(row.exercise_minutes)} min`)
      if (row.active_kcal !== null) said.push(`${calText(row.active_kcal)} cal`)
      said.push(...row.workouts.map(workoutPart))
    }
    return said.length === 0
      ? { parts: [NOTHING] }
      : { parts: [stampDate(date), ...said], open: true }
  }

  const moveWeekRead = (monday: string): Readout => {
    const week = weekRows(fitDays, monday)
    const average = (pick: (row: FitnessDay) => number | null): number | null => {
      const known = week.map(pick).filter((value): value is number => value !== null)
      return known.length === 0 ? null : mean(known)
    }
    const steps = average((row) => row.steps)
    const minutes = average((row) => row.exercise_minutes)
    const kcal = average((row) => row.active_kcal)
    const sessions = week.reduce((count, row) => count + row.workouts.length, 0)
    const said: string[] = []
    if (steps !== null) said.push(`${calText(steps)} steps/day avg`)
    if (minutes !== null) said.push(`${Math.round(minutes)} min/day avg`)
    if (kcal !== null) said.push(`${calText(kcal)} calories/day avg`)
    if (sessions > 0) said.push(sessions === 1 ? '1 workout' : `${sessions} workouts`)
    return said.length === 0
      ? { parts: [NOTHING] }
      : { parts: [`Week of ${monthDay(monday)}`, ...said] }
  }

  const foodDate = columnDate(intake, foodPick)
  const foodRead =
    foodDate === null ? null : weeks ? foodWeekRead(foodDate) : foodDayRead(foodDate)
  const moveDate = columnDate(stepBars, movePick)
  const moveRead =
    moveDate === null ? null : weeks ? moveWeekRead(moveDate) : moveDayRead(moveDate)

  // The one weigh-in a point on the chart is about, and the shares it carried.
  const picked = weighPick === null ? undefined : recorded.find((row) => row.date === weighPick)
  const shareParts = LINE_SPECS.filter((spec) => spec.key !== 'weight').flatMap((spec) => {
    const value = picked === undefined ? null : picked[spec.field]
    return value === null ? [] : [`${spec.word} ${round1(value)}%`]
  })

  // Today as rings: what was walked, what is left to eat, and what was worked,
  // then the three the day's food is made of. The row is always the same
  // length, so a phone that sends nothing shows an empty steps ring rather
  // than moving the other two. The last three only appear where there is room.
  const steps = day?.steps ?? null
  const remaining = day?.remaining_calories ?? 0
  const ringBudget = (day?.budget.calories ?? 0) + (day?.exercise_kcal ?? 0)
  const minutesGoal = day?.exercise_minutes_goal ?? 0
  const macroRing = (
    key: 'protein_g' | 'carbs_g' | 'fat_g',
    word: string,
    color: string,
  ): RingSpec => {
    const eaten = day?.totals[key] ?? 0
    const budget = day?.budget[key] ?? 0
    return {
      key,
      filled: day === null || budget <= 0 ? 0 : eaten / budget,
      centre: day === null ? '\u2013' : `${calText(eaten)} g`,
      caption: `of ${calText(budget)} g ${word}`,
      label: `${word[0].toUpperCase()}${word.slice(1)} today. Opens the Journal.`,
      color,
      onOpen: onOpenJournal,
      wide: true,
    }
  }
  const rings: RingSpec[] = [
    {
      key: 'steps',
      filled: steps === null || stepGoal <= 0 ? 0 : steps / stepGoal,
      centre: steps === null ? '\u2013' : calText(steps),
      caption: steps === null ? 'Sync a device' : `of ${calText(stepGoal)} steps`,
      label: "Steps today. Opens today's goals.",
      color: 'var(--blue)',
      onOpen: () => setGoaling(true),
    },
    {
      key: 'calories',
      filled: ringBudget <= 0 ? 0 : (day?.totals.calories ?? 0) / ringBudget,
      centre: day === null ? '\u2013' : calText(Math.abs(remaining)),
      caption: remaining < 0 ? 'cal over' : 'cal remaining',
      label: 'Calories today. Opens the Journal.',
      color: 'var(--accent)',
      onOpen: onOpenJournal,
    },
    {
      key: 'exercise',
      filled: minutesGoal <= 0 ? 0 : (day?.exercise_minutes ?? 0) / minutesGoal,
      centre: day === null ? '\u2013' : String(day.exercise_minutes),
      caption: `of ${minutesGoal} min`,
      label: "Exercise minutes today. Opens today's goals.",
      color: 'var(--orange)',
      onOpen: () => setGoaling(true),
    },
    macroRing('protein_g', 'protein', 'var(--violet)'),
    macroRing('carbs_g', 'carbs', 'var(--gold)'),
    macroRing('fat_g', 'fat', 'var(--coral)'),
  ]

  // The same calories, said once more in small type on the card that is about
  // eating. The big version of this number lives in the Journal.
  const leftToday =
    remaining < 0
      ? `${calText(Math.abs(remaining))} cal over today`
      : `${calText(remaining)} cal remaining today`

  // Rendered after the sheet it is asked from, so it sits over it.
  const askDelete = (
    <ConfirmSheet
      open={asking !== null}
      label="Delete measurements"
      question={
        asking === null ? '' : `Delete the measurements for ${dayLabel(asking.date, todayIso)}?`
      }
      note="They cannot be recovered."
      verb="Delete"
      onConfirm={() => {
        if (asking === null) return
        const row = asking
        setAsking(null)
        closeMeasurements()
        removeMeasurement(row)
      }}
      onClose={() => setAsking(null)}
    />
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
    return (
      <MemberView
        userId={member}
        back="Dashboard"
        onBack={() => setMember(null)}
        onChange={onChanged}
      />
    )
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
    const newest = windowed?.latest.weight_kg ?? null
    // This screen's own four weeks, whatever span the Dashboard is reading.
    const recent = run.slice(-RUN_DAYS)
    const completedRun = recent.filter((row) => row.completed).length
    const runBars: Bar[] = recent.map((row) => ({
      date: row.date,
      value: row.calories,
      target: row.budget,
      has: row.logged,
    }))
    const runLogged = recent.filter((row) => row.logged)
    const runBudget = recent.length === 0 ? 0 : recent[recent.length - 1].budget
    const runFooter =
      runLogged.length === 0
        ? 'Log a few days to see them here.'
        : `Average ${calText(barsAverage(runBars))} cal a day · budget ${calText(runBudget)}`

    return (
      <>
        <div className="t-card mb-3">
          {!trending ? (
            <>
              <p className="text-sm text-muted">Weigh in a few more times to see a trend.</p>
              <button type="button" className="t-btn mt-3" onClick={openWeighIn}>
                Weigh in
              </button>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  {newest !== null && (
                    <span className="t-nums block text-3xl font-semibold leading-tight">
                      {weightText(newest.value, me.units)}
                    </span>
                  )}
                  <span className="block text-xs text-muted">
                    {newest === null ? '' : `${dayLabel(newest.date, todayIso)} · `}
                    {changeText(line, shares, me.units, chosen.over, lines)}
                    {goalMonth}
                  </span>
                </span>
                <button type="button" className="t-btn shrink-0" onClick={openWeighIn}>
                  Weigh in
                </button>
              </div>
              <LineChips lines={lines} onPick={pickLines} />
              <Spark series={chart} tall axis />
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
            {bmi !== null && (
              <div className="t-row min-h-9 text-sm">
                <span className="flex-1 text-muted">Body mass index</span>
                <span className="t-nums">{bmi}</span>
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
          {recorded.length === 0 ? (
            <>
              <p className="text-sm text-muted">Nothing measured in this window.</p>
              <button
                type="button"
                className="t-btn t-btn-primary mt-3"
                onClick={() => openMeasurements(todayIso)}
              >
                Log biometrics
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
                  onOpen={() => openMeasurements(row.date)}
                />
              </div>
            ))
          )}
        </div>

        {measuring !== null && (
          <MeasurementsSheet
            me={me}
            date={measuring}
            weighIn={weighing}
            onClose={closeMeasurements}
            onSaved={reload}
            onDelete={() => {
              const row = rows.find((one) => one.date === measuring)
              if (row) setAsking(row)
            }}
          />
        )}
        {askDelete}
      </>
    )
  }

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}

      {/* Every ring is its own way in, so the card is a plain card and the
          head is a button of its own: a button inside a button is not a thing
          a screen reader can hand anybody. */}
      <div data-tour="dash-today" className="t-card mb-3">
        <button
          type="button"
          className="t-micro t-tap44 mb-2 flex items-center gap-1"
          aria-label="Today. Opens the Journal."
          onClick={onOpenJournal}
        >
          Today
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
        <Rings rings={rings} />
      </div>

      {/* One switch over every card that reads a run of days, standing where
          the heading was: the control says what the cards are of, so none of
          them says it again. The range wraps under it on a phone. It stays
          under the bar as the cards go by, on the page's own ground and bled
          to the well's edges so they pass behind it rather than beside it. */}
      <div className="sticky top-[calc(48px_+_env(safe-area-inset-top))] z-10 -mx-3.5 mb-2 mt-1 flex flex-wrap items-center gap-2 bg-bg px-4.5 py-2 min-[900px]:-mx-6 min-[900px]:px-7">
        {SPANS.map((row) => (
          <button
            key={row.days}
            type="button"
            aria-pressed={span === row.days}
            className={`t-chip ${span === row.days ? 'border-accent text-accent' : ''}`}
            onClick={() => setSpan(row.days)}
          >
            {row.label}
          </button>
        ))}
        <span className="t-nums w-full text-xs text-muted min-[900px]:ml-auto min-[900px]:w-auto">
          {monthDay(dates[0])} to {monthDay(dates[dates.length - 1])}
        </span>
      </div>

      <div className="t-card mb-3">
        <CardHead label="Food" onOpen={onOpenJournal} onAdd={() => setPicking(true)} />
        {foodRead !== null ? (
          <PointReadout
            className="mb-2"
            parts={foodRead.parts}
            done={foodRead.done}
            onOpen={
              foodRead.open === true && foodDate !== null
                ? () => onOpenJournalDay(foodDate)
                : undefined
            }
          />
        ) : (
          day !== null && <p className="t-nums mb-2 text-xs text-muted">{leftToday}</p>
        )}
        {logged.length === 0 && (
          <p className="mb-2 text-sm">
            Log a day to see {chosen.label === 'This week' ? 'this week' : `the last ${chosen.label.toLowerCase()}`}.
          </p>
        )}
        <div className="mb-3 flex gap-6">
          <Stat value={`${underTarget} of ${dates.length}`} label="Days within budget" />
          <Stat value={`${completedDays} of ${dates.length}`} label="Days completed" />
        </div>
        <DayBars
          bars={intake}
          footer={intakeFooter}
          todayIso={todayIso}
          warnOver
          highlightToday
          mondaysOnly={!isWeek && !weeks}
          weeks={weeks}
          label={labelled ? calText : undefined}
          titleUnit="cal"
          weekUnit="calories"
          selected={foodPick}
          onSelect={setFoodPick}
        />
      </div>

      <div className="t-card mb-3">
        <CardHead
          label="Activity"
          onOpen={onOpenFitness}
          onAdd={() => setExercising(true)}
        />
        {fitness !== null && fitness.connected ? (
          <>
            <div className={`flex gap-6 ${isWeek || moveRead !== null ? 'mb-1' : 'mb-3'}`}>
              <Stat value={`${goalMet} of ${dates.length}`} label="Days at step goal" />
            </div>
            {/* How many sessions the week holds. The summary counts no other
                span, so no other span says it. */}
            {moveRead !== null ? (
              <PointReadout
                className="mb-3"
                parts={moveRead.parts}
                onOpen={
                  moveRead.open === true && moveDate !== null
                    ? () => onOpenFitnessDay(moveDate)
                    : undefined
                }
              />
            ) : (
              isWeek && <p className="mb-3 text-xs text-muted">{sessionsLine}</p>
            )}
            <DayBars
              bars={stepBars}
              footer={stepsFooter}
              todayIso={todayIso}
              highlightToday
              mondaysOnly={!isWeek && !weeks}
              weeks={weeks}
              label={labelled ? stepsLabel : undefined}
              titleUnit="steps"
              selected={movePick}
              onSelect={setMovePick}
            />
          </>
        ) : (
          <>
            <p className="text-base font-semibold tracking-tight">
              Active on {movedDays} of {dates.length} days
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
          <p className="text-sm text-muted">Nothing measured yet.</p>
        ) : (
          <>
            {/* The newest weight there is, which is not always the newest day:
                a day can hold a body fat and no weight. */}
            {weighed !== null && (
              <>
                <span className="t-nums block text-3xl font-semibold leading-tight">
                  {/* A chosen day shows its own weight. A day that weighed
                      nothing leaves the newest one standing. */}
                  {weightText(picked?.weight_kg ?? weighed.value, me.units)}
                </span>
                {/* The smoothed figure stays off the card: the change and the
                    goal date underneath are read from it, and one number is
                    enough. */}
                {weighPick === null ? (
                  <span className="block text-xs text-muted">
                    {dayLabel(weighed.date, todayIso)}
                  </span>
                ) : (
                  <PointReadout
                    parts={picked === undefined ? [NOTHING] : [stampDate(weighPick)]}
                    onOpen={picked === undefined ? undefined : () => setMeasuring(weighPick)}
                  />
                )}
              </>
            )}
            {!trending ? (
              <span className="block text-xs text-muted">
                Weigh in a few more times to see a trend.
              </span>
            ) : (
              <>
                {weighPick === null ? (
                  <span className="block text-xs text-muted">
                    {changeText(line, shares, me.units, chosen.over, lines)}
                    {goalMonth}
                  </span>
                ) : (
                  <PointReadout parts={shareParts} />
                )}
                <LineChips lines={lines} onPick={pickLines} />
                <Spark series={chart} axis selected={weighPick} onSelect={setWeighPick} />
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

      {goaling && (
        <GoalSheet
          me={me}
          date={todayIso}
          onClose={() => setGoaling(false)}
          onSaved={reload}
        />
      )}

      {askDelete}
    </>
  )
}
