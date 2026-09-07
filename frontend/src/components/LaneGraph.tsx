// The session minute by minute: heart rate and pace as two lanes over one
// time axis, with one cursor across both. Each lane keeps its own true scale,
// because a beat and a pace are different measurements and share nothing but
// the minutes underneath.

import { useRef, useState, type PointerEvent, type RefObject } from 'react'

import type { WorkoutSample } from '../api'
import { stepOf } from '../lib/splits'
import { distanceIn, elapsedText, paceText } from '../lib/units'
import { RouteLine, type RouteMarker } from './RouteLine'

// A lane's own coordinates. The height is also its height on the page, in
// pixels, so nothing about the vertical scale changes with the width of the
// column: only the horizontal stretches, and every stroke in it keeps its
// weight whatever it is stretched to.
const PLOT_W = 400
const PLOT_H = 110
// Room at the top and the bottom for the line's own thickness, so a peak
// touching the ceiling is not sliced in half by the edge of the box.
const INSET = 3

const MINUTE_S = 60

// What the readout says with nothing under the pointer. It is the instruction
// for the cursor as well as the line that keeps the row from collapsing when
// there is no reading to put in it.
const CURSOR_HINT = 'Drag across for the reading at a minute.'

type LaneKey = 'hr' | 'pace'

// One lane: a series already turned into plot coordinates, the three labels
// beside it, and what it read at each minute. The readings are looked up by
// minute rather than by position, because a lane leaves out the minutes it has
// nothing to say about and the minute numbers are the one thing every lane
// shares.
interface Lane {
  key: LaneKey
  name: string
  colour: string
  summary: string
  line: string
  band: string
  labels: string[]
  said: Map<number, string>
}

// What another member's sharing left out is absent from the answer, so every
// reading is asked whether it is a number at all.
const reading = (value: number | null | undefined): value is number =>
  typeof value === 'number'

// Plot coordinates down a lane's own scale. A lane can read the other way up:
// pace is drawn inverted, with the fewest seconds a mile at the top, because a
// quicker minute is the better minute and that is the way a pace is read.
function laneY(value: number, low: number, high: number, inverted: boolean): number {
  const span = high - low || 1
  const part = (value - low) / span
  const up = inverted ? 1 - part : part
  return PLOT_H - INSET - up * (PLOT_H - INSET * 2)
}

// The stretch of readings a lane's axis is worth setting to. Sixty seconds
// over a few metres is a true minute and an hour and a half a mile, and an axis
// stretched far enough to name it leaves every other minute pressed into one
// flat line, so the ends come from the readings within a third and three times
// the middle one and anything outside them hangs off the lane.
function typicalBounds(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1]
  const plain: [number, number] = [Math.min(...values), Math.max(...values)]
  const sorted = [...values].sort((a, b) => a - b)
  const half = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[half - 1] + sorted[half]) / 2 : sorted[half]
  if (median <= 0) return plain
  const kept = sorted.filter((value) => value >= median / 3 && value <= median * 3)
  if (kept.length === 0) return plain
  return [kept[0], kept[kept.length - 1]]
}

// A pace of so many seconds a mile or kilometre, written the way the app writes
// every other pace.
const paceOf = (seconds: number, units: 'imperial' | 'metric'): string =>
  paceText(stepOf(units), seconds, units) ?? ''

// The same figure without the unit, which is what goes down the side of a lane:
// naming /mi three times on one axis says nothing the readout does not.
const paceLabel = (seconds: number, units: 'imperial' | 'metric'): string =>
  paceOf(seconds, units).split(' ')[0]

// The lanes a session has anything to draw, in the order they are stacked. A
// lane with fewer than two readings is not a line, and it is left out rather
// than drawn as a dot.
function lanesOf(
  samples: WorkoutSample[],
  units: 'imperial' | 'metric',
  atX: (minute: number) => number
): Lane[] {
  const lanes: Lane[] = []
  const spot = (minute: number, y: number) => `${atX(minute).toFixed(1)},${y.toFixed(1)}`

  // Heart rate: the average of each minute as a line, and the range that minute
  // covered as a faint band behind it.
  const beats: { minute: number; avg: number; low: number; high: number; ranged: boolean }[] = []
  for (const row of samples) {
    const avg = row.hr_avg
    if (!reading(avg)) continue
    beats.push({
      minute: row.minute,
      avg,
      low: reading(row.hr_min) ? row.hr_min : avg,
      high: reading(row.hr_max) ? row.hr_max : avg,
      ranged: reading(row.hr_min) && reading(row.hr_max),
    })
  }
  if (beats.length > 1) {
    const floor = Math.round(Math.min(...beats.map((row) => row.low)))
    const roof = Math.round(Math.max(...beats.map((row) => row.high)))
    const at = (value: number) => laneY(value, floor, roof, false)
    // The band is drawn only over the minutes that recorded both ends of a
    // range, out along the highs and back along the lows.
    const ranged = beats.filter((row) => row.ranged)
    const highs = ranged.map((row) => spot(row.minute, at(row.high)))
    const lows = ranged.map((row) => spot(row.minute, at(row.low))).reverse()
    lanes.push({
      key: 'hr',
      name: 'Heart rate',
      colour: 'var(--coral)',
      summary: `Heart rate over ${beats.length} minutes, ${floor} to ${roof} bpm`,
      line: beats.map((row) => spot(row.minute, at(row.avg))).join(' '),
      band: ranged.length > 1 ? `M${highs.join('L')}L${lows.join('L')}Z` : '',
      labels: [String(roof), String(Math.round((floor + roof) / 2)), String(floor)],
      said: new Map(beats.map((row) => [row.minute, `${Math.round(row.avg)} bpm`])),
    })
  }

  // Pace, worked out from the distance each minute covered: a minute is a
  // minute, so sixty seconds over what it covered is that minute's pace. A
  // minute that covered nothing has no pace at all, and it is left out rather
  // than drawn as an hour a mile that would flatten every other minute.
  const moving: { minute: number; metres: number }[] = []
  for (const row of samples) {
    if (reading(row.distance_m) && row.distance_m > 0) {
      moving.push({ minute: row.minute, metres: row.distance_m })
    }
  }
  if (moving.length > 1) {
    const seconds = moving.map((row) => MINUTE_S / distanceIn(row.metres, units))
    const quickest = Math.min(...seconds)
    const slowest = Math.max(...seconds)
    // The axis is set to the minutes that were actually run. The true ends
    // still go in the summary, and a crawling minute is still drawn and still
    // read out honestly when the cursor lands on it.
    const [quick, slow] = typicalBounds(seconds)
    const at = (value: number) => laneY(value, quick, slow, true)
    lanes.push({
      key: 'pace',
      name: 'Pace',
      colour: 'var(--blue)',
      summary: `Pace over ${moving.length} minutes, fastest ${paceOf(
        quickest,
        units
      )}, slowest ${paceOf(slowest, units)}`,
      line: moving.map((row, index) => spot(row.minute, at(seconds[index]))).join(' '),
      band: '',
      labels: [
        paceLabel(quick, units),
        paceLabel((quick + slow) / 2, units),
        paceLabel(slow, units),
      ],
      said: new Map(
        moving.map((row) => [row.minute, paceText(row.metres, MINUTE_S, units) ?? ''])
      ),
    })
  }

  return lanes
}

export function LaneGraph({
  samples,
  units,
  places,
  marker,
  route,
}: {
  samples: WorkoutSample[]
  units: 'imperial' | 'metric'
  // How far along the session each minute is, for the dot on the route line.
  // Empty on a workout with no line to put one on.
  places: Map<number, number>
  marker: RefObject<RouteMarker | null>
  // The same points the drawing at the top of the screen has, for the strip
  // that rides along with the readout. Null where there is no line.
  route: [number, number][] | null
}) {
  const [shown, setShown] = useState<Record<LaneKey, boolean>>({ hr: true, pace: true })
  // The cursor is written straight onto the drawing rather than rendered: the
  // rule's x and the readout's words are set as attributes through these refs,
  // because a position worked out per pointer event should not cost a render.
  const plots = useRef(new Map<LaneKey, SVGSVGElement>())
  const rules = useRef(new Map<LaneKey, SVGLineElement>())
  const readout = useRef<HTMLParagraphElement>(null)
  // The strip beside the readout carries a dot of its own, and the drawing at
  // the top of the screen keeps the one it already had. One cursor reads one
  // minute, so both are driven together and neither is told which it is.
  const strip = useRef<RouteMarker | null>(null)
  // The minute a tap settled on. A finger that lifts has not stopped reading,
  // so the choice outlives the gesture; null is nothing chosen, which is what
  // the hint line and a passing hover both are.
  const pinned = useRef<number | null>(null)

  const dots = [marker, strip]
  const first = samples[0]?.minute ?? 0
  const last = samples[samples.length - 1]?.minute ?? 0
  const across = last - first || 1
  const atX = (minute: number) => ((minute - first) / across) * PLOT_W
  const lanes = lanesOf(samples, units, atX)
  if (lanes.length === 0) return null

  function clearCursor() {
    pinned.current = null
    for (const rule of rules.current.values()) rule.setAttribute('visibility', 'hidden')
    for (const dot of dots) dot.current?.clear()
    if (readout.current !== null) readout.current.textContent = CURSOR_HINT
  }

  // One minute, drawn in every lane at once. Every lane's plot sits in the same
  // column at the same width, so one of their boxes is every lane's box and the
  // rule lands at the same x in all of them.
  function drawAt(minute: number) {
    const x = atX(minute).toFixed(1)
    for (const rule of rules.current.values()) {
      rule.setAttribute('x1', x)
      rule.setAttribute('x2', x)
      rule.setAttribute('visibility', 'visible')
    }
    // And where on the route the session had reached by then, where there is a
    // line to say. A minute the phone was not recording has no place on it, and
    // the dot waits there rather than jumping to an end of the line.
    const place = places.get(minute)
    if (place !== undefined) {
      for (const dot of dots) dot.current?.at(place)
    }
    // A row is a whole minute rather than an instant, so the reading is named
    // at the middle of the minute it came out of rather than at either end.
    const parts = [elapsedText(minute * MINUTE_S + MINUTE_S / 2)]
    for (const lane of lanes) {
      const value = shown[lane.key] ? lane.said.get(minute) : undefined
      if (value !== undefined && value !== '') parts.push(value)
    }
    // A reading stays whole when the line wraps: the spaces inside one are
    // the kind that do not break, so a wrap only ever falls between readings.
    if (readout.current !== null) {
      readout.current.textContent = parts.map((part) => part.replace(/ /g, '\u00a0')).join(' · ')
    }
  }

  // Where the pointer is, as the minute nearest it. Pinning is what a
  // deliberate gesture does: a tap, and a drag of either kind. A mouse crossing
  // the lanes with no button held is only looking, and looking leaves the
  // choice alone.
  function readAt(event: PointerEvent<HTMLDivElement>, pin: boolean) {
    const plot = plots.current.values().next().value
    if (plot === undefined) return
    const box = plot.getBoundingClientRect()
    if (box.width <= 0) return
    const part = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    const minute = first + Math.round(part * across)
    if (pin) pinned.current = minute
    drawAt(minute)
  }

  // A pointer leaving is not the reading ending. A phone has nothing else to do
  // with a finger once it lifts, and wiping the line then would leave the
  // reader holding nothing; a mouse wandering off goes back to the minute that
  // was chosen rather than to whatever it grazed on the way out. With nothing
  // chosen there is nothing to go back to, and the hint returns.
  function restoreCursor() {
    if (pinned.current !== null) drawAt(pinned.current)
    else clearCursor()
  }

  return (
    <div className="t-card mb-3">
      <p className="t-micro mb-2">Minute by minute</p>

      {/* One chip a lane, and only for a lane there is something to draw. Which
          lanes are showing is not worth remembering between one screen and the
          next. A single lane needs no chip to turn it off. */}
      {lanes.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {lanes.map((lane) => (
            <button
              key={lane.key}
              type="button"
              className="t-chip"
              aria-pressed={shown[lane.key]}
              // The lane's own colour, so a chip wears the line it turns off.
              style={
                shown[lane.key]
                  ? { borderColor: lane.colour, color: lane.colour }
                  : undefined
              }
              onClick={() => {
                setShown({ ...shown, [lane.key]: !shown[lane.key] })
                // A lane arriving or leaving would leave the rule half drawn
                // and the readout naming a lane that is gone.
                clearCursor()
              }}
            >
              {lane.name}
            </button>
          ))}
        </div>
      )}

      {/* The reading follows the lanes down the screen. A stack of four lanes is
          taller than the phone it is read on, and a line naming what the cursor
          is on is no use parked above the top of the view. The route comes with
          it: the same dot the drawing at the top of the screen is carrying, in a
          strip small enough to ride along. */}
      <div className="sticky top-[calc(48px_+_env(safe-area-inset-top))] z-10 -mx-3.5 mb-1 flex items-stretch gap-2 bg-surface px-3.5 pb-1">
        {route !== null && <RouteLine points={route} compact marker={strip} />}
        {/* The words sit level with the strip beside them, and the box they sit
            in starts where the bar above ends, so the line lands under the bar
            rather than a few pixels down from it. */}
        <p
          className="t-nums flex min-h-4 items-center text-xs text-muted"
          role="status"
          ref={readout}
        >
          {CURSOR_HINT}
        </p>
      </div>

      <div
        className="touch-pan-y select-none"
        onPointerDown={(event) => {
          // Capture, so a thumb dragging off the edge of one lane keeps reading
          // rather than handing the drag back to the page.
          event.currentTarget.setPointerCapture(event.pointerId)
          readAt(event, true)
        }}
        onPointerMove={(event) => {
          readAt(event, !(event.pointerType === 'mouse' && event.buttons === 0))
        }}
        onPointerLeave={restoreCursor}
        onPointerCancel={restoreCursor}
      >
        {lanes
          .filter((lane) => shown[lane.key])
          .map((lane) => (
            <div key={lane.key} className="mb-3 last:mb-0">
              <p className="t-micro mb-1">{lane.name}</p>
              <div className="flex gap-2">
                {/* The axis is written in the page's own type rather than
                    inside the drawing, so it stays the size the rest of the
                    screen is read at whatever width the lane is stretched to. */}
                <div className="t-nums flex h-[110px] w-12 shrink-0 flex-col justify-between text-[10px] text-muted">
                  {lane.labels.map((text, at) => (
                    <span key={at}>{text}</span>
                  ))}
                </div>
                <svg
                  className="h-[110px] w-full"
                  viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={lane.summary}
                  ref={(el) => {
                    if (el === null) plots.current.delete(lane.key)
                    else plots.current.set(lane.key, el)
                  }}
                >
                  {/* Three rules and no more, at the top, the middle and the
                      bottom of the range, which are the three the axis beside
                      them names. */}
                  {[INSET, PLOT_H / 2, PLOT_H - INSET].map((y) => (
                    <line
                      key={y}
                      className="t-stroke"
                      x1="0"
                      y1={y}
                      x2={PLOT_W}
                      y2={y}
                      stroke="var(--line)"
                      strokeWidth={1}
                    />
                  ))}
                  {lane.band !== '' && (
                    <path d={lane.band} fill={lane.colour} opacity={0.16} />
                  )}
                  <polyline
                    className="t-stroke"
                    points={lane.line}
                    fill="none"
                    stroke={lane.colour}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <line
                    className="t-stroke"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2={PLOT_H}
                    stroke="var(--text)"
                    strokeWidth={1}
                    opacity={0.45}
                    visibility="hidden"
                    ref={(el) => {
                      if (el === null) rules.current.delete(lane.key)
                      else rules.current.set(lane.key, el)
                    }}
                  />
                </svg>
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
