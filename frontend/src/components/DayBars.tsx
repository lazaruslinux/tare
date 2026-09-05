import type { CSSProperties } from 'react'

import { shiftDay, weekday } from '../lib/day'

// A run of days as bars: one column a day, oldest on the left, today on the
// right. Drawn by hand out of two divs a column, because a chart library for
// seven numbers is a library nobody reads.
//
// It draws a plain series rather than a diary day, so the same picture serves
// what was eaten against a budget and what was walked against a goal. What the
// line under it says is the caller's, because only the caller knows what the
// numbers are of.

// One column: the day, its number, what that day aimed at, and whether there
// is an answer for it at all. A day with no answer is a gap, not a zero. The
// axis word is for a column that stands for more than a day, where a weekday
// letter would say nothing.
export type Bar = {
  date: string
  value: number
  target: number
  has: boolean
  axis?: string
}

// The one letter under each bar. Read off the date as UTC, which is the
// calendar day the server already worked out in the member's own zone.
const INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONDAY = 1

// A share of the tallest thing on the chart, as a percentage of the block.
const share = (value: number, ceiling: number): number =>
  ceiling <= 0 ? 0 : Math.min(Math.max(value / ceiling, 0), 1) * 100

// Headroom over the tallest thing, so the goal line never sits on the top edge
// where it cannot be seen, and a number over a full bar has somewhere to go.
const HEADROOM = 1.2

// How tall the block is on a wide screen, where the numbers over the bars need
// the room.
const WIDE_HEIGHT = 72

// "Sep", for the month a week belongs to.
const monthName = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'short',
  })

// "Week of Sep 1", for a column that stands for seven days rather than one.
const weekTitle = (iso: string): string =>
  `Week of ${new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  })}`

// "Tue Sep 2", for the tooltip a pointer gets on a column.
const dayTitle = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`)
    .toLocaleDateString(undefined, {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    .replace(',', '')

// The number said plainly. The label over a bar may be short ("7.0k"); a
// tooltip has room for the whole thing.
const plain = (value: number): string => Math.round(value).toLocaleString()

// The mean across the days that have an answer, which is what every footer
// under one of these charts is built from.
export function barsAverage(bars: Bar[]): number {
  const known = bars.filter((row) => row.has)
  if (known.length === 0) return 0
  return Math.round(known.reduce((sum, row) => sum + row.value, 0) / known.length)
}

// The same run said one bar a week, Monday first: each week is the average of
// its days that have an answer, so a week only half logged still reads at the
// height it was lived at rather than half of it. The first and last weeks of a
// span are usually part weeks. Under the bars, a month is named once, at the
// first week that starts in it.
export function weekly(bars: Bar[]): Bar[] {
  const found = new Map<string, { sum: number; count: number; target: number }>()
  const order: string[] = []
  for (const row of bars) {
    const monday = shiftDay(row.date, -((weekday(row.date) + 6) % 7))
    let cell = found.get(monday)
    if (cell === undefined) {
      cell = { sum: 0, count: 0, target: row.target }
      found.set(monday, cell)
      order.push(monday)
    }
    cell.target = row.target
    if (row.has) {
      cell.sum += row.value
      cell.count += 1
    }
  }
  let named = ''
  return order.map((monday) => {
    const cell = found.get(monday) ?? { sum: 0, count: 0, target: 0 }
    const month = monthName(monday)
    const axis = month === named ? '' : month
    named = month
    return {
      date: monday,
      value: cell.count === 0 ? 0 : cell.sum / cell.count,
      target: cell.target,
      has: cell.count > 0,
      axis,
    }
  })
}

export function DayBars({
  bars,
  footer,
  todayIso,
  height = 56,
  // Twenty-eight letters in a row is a smudge, so the long view names the
  // weeks instead: one letter a Monday.
  mondaysOnly = false,
  // Whether going past the day's number is worth marking. Eating over a budget
  // is; walking past a step goal is the point.
  warnOver = false,
  // Whether the run is the week somebody is standing in, which is the only
  // time saying which column is today tells them anything.
  highlightToday = false,
  // What to print over each bar on a wide screen. A phone has no room for it.
  label,
  // The word the numbers are in, which is the only part of a tooltip this
  // component cannot work out for itself. No word, no tooltip.
  titleUnit,
  // Whether a column is a week rather than a day, which changes what a
  // tooltip is about and puts the marker on the week being lived in.
  weeks = false,
}: {
  bars: Bar[]
  footer: string
  todayIso: string
  height?: number
  mondaysOnly?: boolean
  warnOver?: boolean
  highlightToday?: boolean
  label?: (value: number) => string
  titleUnit?: string
  weeks?: boolean
}) {
  const ceiling =
    Math.max(...bars.map((row) => Math.max(row.target, row.value)), 1) * HEADROOM
  const tall = Math.max(height, WIDE_HEIGHT)
  // One line across the block when every day is read against the same number,
  // which is what the day view does today. Otherwise each bar carries its own.
  const target = bars.length === 0 ? 0 : bars[bars.length - 1].target
  const oneTarget = bars.every((row) => row.target === target)
  const gap = bars.length > 14 ? 'gap-[2px]' : 'gap-1'

  return (
    <div>
      <div
        className="relative h-[var(--bars-h)] min-[900px]:h-[var(--bars-tall)]"
        style={
          { '--bars-h': `${height}px`, '--bars-tall': `${tall}px` } as CSSProperties
        }
        aria-hidden="true"
      >
        {/* The ground the bars stand on: a hairline across the whole row, so a
            week with little in it reads as a quiet week rather than as a box
            of empty slabs. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-line" />
        <div className={`flex h-full items-end ${gap}`}>
          {bars.map((row) => (
            <div
              key={row.date}
              className="relative h-full flex-1"
              // A pointer gets the day and its two numbers. Harmless on a
              // phone, which never shows it.
              title={
                titleUnit === undefined || !row.has
                  ? undefined
                  : weeks
                    ? `${weekTitle(row.date)}: ${plain(row.value)} of ${plain(row.target)} ${titleUnit} a day`
                    : `${dayTitle(row.date)}: ${plain(row.value)} of ${plain(row.target)} ${titleUnit}`
              }
            >
              {row.has ? (
                <div
                  className="t-bar absolute inset-x-0 bottom-0 mx-auto max-w-5 rounded-sm"
                  style={{
                    height: `${share(row.value, ceiling)}%`,
                    background:
                      warnOver && row.value > row.target
                        ? 'var(--pending)'
                        : 'var(--accent)',
                  }}
                />
              ) : (
                // A day with no answer is a dot on the line and nothing else.
                // A filled slab in its place reads as a tall bar of something.
                <span className="absolute bottom-0 left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-muted" />
              )}
              {label !== undefined && row.has && (
                <span
                  className="t-nums absolute inset-x-0 hidden text-center text-[10px] text-muted min-[900px]:block"
                  style={{ bottom: `calc(${share(row.value, ceiling)}% + 2px)` }}
                >
                  {label(row.value)}
                </span>
              )}
              {!oneTarget && (
                <div
                  className="absolute inset-x-0 border-t border-dashed border-line-strong"
                  style={{ bottom: `${share(row.target, ceiling)}%` }}
                />
              )}
            </div>
          ))}
        </div>
        {oneTarget && target > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line-strong"
            style={{ bottom: `${share(target, ceiling)}%` }}
          />
        )}
      </div>

      <div className={`mt-1 flex ${gap}`}>
        {bars.map((row, index) => {
          const initial = INITIALS[weekday(row.date)]
          const letter = mondaysOnly && weekday(row.date) !== MONDAY ? '' : initial
          // A column that names itself says that instead of a weekday letter.
          const shown = row.axis ?? letter
          // The last week is the one being lived in, the way today is the day.
          const now = weeks ? index === bars.length - 1 : row.date === todayIso
          return (
            <span
              key={row.date}
              className={`min-w-0 flex-1 text-center text-[10px] ${
                now ? '' : 'text-muted'
              }`}
            >
              {shown === '' ? ' ' : shown}
              {/* A short rule under today's letter. An outline around the
                  column itself lands on the dashed target line and reads as
                  part of the chart; this only marks where the reader is. */}
              {highlightToday && now && (
                <span className="mx-auto mt-0.5 block h-0.5 w-3 rounded-full bg-accent" />
              )}
            </span>
          )
        })}
      </div>

      <p className="mt-2 text-xs text-muted">
        <span className="t-nums">{footer}</span>
      </p>
    </div>
  )
}
