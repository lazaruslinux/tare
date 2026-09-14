import { useEffect, useRef, useState, type RefObject } from 'react'

import type { Occurrence } from '../../api'
import { useClock } from '../../lib/clock'
import {
  colorToken,
  formatTimeRange,
  hourLabel,
  minutesOf,
  nowMinutesIn,
  PERSONAL,
} from '../../lib/calendar'

// One day drawn against the clock: an hour a row, the day's entries laid on
// the hours they cover, and a red line at whatever time it is now.
//
// The same component draws the whole day on the Calendar page and the few
// hours around now on the Dashboard, which is the only reason it takes the
// hours it starts and stops at.

const MINUTE = 60
const HOURS = 24
// A block shorter than this cannot be read, so a short one is drawn at this
// height and packed at it too, or its neighbour would be laid on top of it.
const MIN_BLOCK = 44

export type Placed = {
  item: Occurrence
  top: number
  height: number
  column: number
  columns: number
}

// What time it is where the account is, minute by minute. A whole minute is
// close enough for a line across a day, and it is one timer rather than one
// per block.
export function useNowMinutes(timezone: string): number {
  const [minutes, setMinutes] = useState(() => nowMinutesIn(timezone))
  useEffect(() => {
    setMinutes(nowMinutesIn(timezone))
    const timer = window.setInterval(() => setMinutes(nowMinutesIn(timezone)), 60_000)
    return () => window.clearInterval(timer)
  }, [timezone])
  return minutes
}

// Which entries have no time of day, and so belong in the lane above the
// hours rather than on them.
export const allDayItems = (items: Occurrence[]): Occurrence[] =>
  items.filter((item) => item.all_day || item.start === null)

const timedItems = (items: Occurrence[]): Occurrence[] =>
  items.filter((item) => !item.all_day && item.start !== null)

// Where one entry starts and stops on the day it is drawn on, in minutes. A
// run that began yesterday starts at the top of the day, and one that carries
// on tomorrow runs to the bottom.
function extent(item: Occurrence): { from: number; to: number } {
  const from = item.continues_from_previous ? 0 : minutesOf(item.start ?? '00:00')
  const to = item.continues_to_next ? HOURS * MINUTE : minutesOf(item.end ?? '00:00')
  return { from, to: Math.max(to, from + 1) }
}

// Overlapping entries share the width they overlap on, each in the leftmost
// column that is free where it starts.
export function pack(items: Occurrence[], perMinute: number): Placed[] {
  const sorted = [...items].sort((one, two) => {
    const gap = extent(one).from - extent(two).from
    return gap !== 0 ? gap : one.title.localeCompare(two.title)
  })
  const placed: Placed[] = []
  const boxes = sorted.map((item) => {
    const { from, to } = extent(item)
    const top = from * perMinute
    return { top, bottom: Math.max(to * perMinute, top + MIN_BLOCK) }
  })

  let cluster: number[] = []
  let clusterBottom = -1
  let columns: number[] = []

  const close = () => {
    for (const index of cluster) placed[index].columns = columns.length
    cluster = []
    columns = []
  }

  sorted.forEach((item, index) => {
    const { top, bottom } = boxes[index]
    if (cluster.length > 0 && top >= clusterBottom) close()
    let column = columns.findIndex((edge) => edge <= top)
    if (column === -1) {
      column = columns.length
      columns.push(bottom)
    } else {
      columns[column] = bottom
    }
    cluster.push(index)
    clusterBottom = Math.max(clusterBottom, bottom)
    placed[index] = { item, top, height: bottom - top, column, columns: 1 }
  })
  close()
  return placed
}

// The colour an entry is drawn in: the first shared calendar it is on, or the
// app's own green for anything that is only mine.
export const tintOf = (item: Occurrence): string =>
  item.calendars.length === 0 ? PERSONAL : colorToken(item.calendars[0].color)

export function DayTimeline({
  items,
  isToday,
  nowMinutes,
  hourPx,
  fromHour = 0,
  toHour = HOURS,
  height,
  wide = false,
  onOpen,
  onAddAt,
  scrollerRef,
  onScroll,
}: {
  items: Occurrence[]
  // Whether the day on screen is the one the account is standing in. Only
  // today gets the line: another day has no now.
  isToday: boolean
  nowMinutes: number
  hourPx: number
  // The window drawn, for the Dashboard's few hours. The whole day otherwise.
  fromHour?: number
  toHour?: number
  height?: number
  // Whether there is room for a block to say where it is as well as when.
  wide?: boolean
  onOpen: (item: Occurrence) => void
  // Tapping an empty hour, which is how a new appointment is started from the
  // day. Absent on the Dashboard, where the card has its own plus.
  onAddAt?: (hour: number) => void
  // The box that scrolls, handed back so a card around it can move it, and
  // where it has been moved to. The Calendar's own day view wants neither.
  scrollerRef?: RefObject<HTMLDivElement | null>
  onScroll?: (top: number) => void
}) {
  const clock = useClock()
  const scroller = useRef<HTMLDivElement>(null)
  const perMinute = hourPx / MINUTE
  const top = fromHour * MINUTE * perMinute
  const placed = pack(timedItems(items), perMinute)
  const hours = Array.from({ length: toHour - fromHour }, (_, index) => fromHour + index)
  const tall = (toHour - fromHour) * hourPx
  const nowTop = nowMinutes * perMinute - top

  // The day opens an hour above the line, or above its first entry on a day
  // that has no line. Landing on the hour rather than between two of them, so
  // the label at the top edge is a whole one. After that it is the reader's.
  useEffect(() => {
    const box = scroller.current
    if (box === null) return
    const anchor = isToday
      ? nowMinutes * perMinute
      : placed.length > 0
        ? Math.min(...placed.map((one) => one.top))
        : 8 * hourPx
    box.scrollTop = Math.max(Math.floor((anchor - top) / hourPx) * hourPx - hourPx, 0)
    onScroll?.(box.scrollTop)
  }, [])

  return (
    <div
      ref={(node) => {
        scroller.current = node
        if (scrollerRef !== undefined) scrollerRef.current = node
      }}
      className="t-cal-timeline"
      style={height === undefined ? undefined : { maxHeight: height }}
      onScroll={
        onScroll === undefined ? undefined : (event) => onScroll(event.currentTarget.scrollTop)
      }
    >
      <div className="relative" style={{ height: tall }}>
        {hours.map((hour) => (
          <div key={hour} className="t-cal-hour" style={{ top: (hour - fromHour) * hourPx }}>
            <span className="t-nums">{hourLabel(hour, clock)}</span>
          </div>
        ))}
        {/* Everything that is laid on the hours lives in here, so a block's
            share of a busy hour is a share of the day and not of the gutter. */}
        <div className="absolute top-0 bottom-0 left-12 right-1">
          {/* An empty hour is the way to add at a time: tapping one opens the
              form on that hour for an hour. */}
          {onAddAt !== undefined &&
            hours.map((hour) => (
              <button
                key={`add-${hour}`}
                type="button"
                aria-label={`Add at ${hourLabel(hour, clock)}`}
                className="absolute right-0 left-0"
                style={{ top: (hour - fromHour) * hourPx, height: hourPx }}
                onClick={() => onAddAt(hour)}
              />
            ))}
          {placed.map((one) => {
            const width = 100 / one.columns
            const tint = tintOf(one.item)
            const roomy = one.height >= 56
            return (
              <button
                key={`${one.item.id}-${one.item.occurrence_date}`}
                type="button"
                className="t-cal-block"
                style={{
                  top: one.top - top,
                  height: one.height - 3,
                  left: `calc(${one.column * width}% + ${one.column > 0 ? 3 : 0}px)`,
                  width: `calc(${width}% - ${one.column > 0 ? 3 : 0}px)`,
                  borderLeftColor: tint,
                  opacity: one.item.cancelled ? 0.6 : 1,
                }}
                onClick={() => onOpen(one.item)}
              >
                <span
                  className={`truncate text-xs font-semibold ${
                    one.item.cancelled ? 'text-muted line-through' : ''
                  }`}
                >
                  {one.item.title}
                </span>
                {roomy && (
                  <span className="t-nums truncate text-[11px] text-muted">
                    {formatTimeRange(one.item.start ?? '', one.item.end, clock)}
                    {wide && one.item.location !== null && ` · ${one.item.location}`}
                  </span>
                )}
              </button>
            )
          })}
          {isToday && nowTop >= 0 && nowTop <= tall && (
            <div className="t-cal-now-line" data-now-line style={{ top: nowTop }} />
          )}
        </div>
      </div>
    </div>
  )
}
