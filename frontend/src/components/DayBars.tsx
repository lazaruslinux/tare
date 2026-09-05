import type { CSSProperties } from 'react'

import { weekday } from '../lib/day'

// A run of days as bars: one column a day, oldest on the left, today on the
// right. Drawn by hand out of two divs a column, because a chart library for
// seven numbers is a library nobody reads.
//
// It draws a plain series rather than a diary day, so the same picture serves
// what was eaten against a budget and what was walked against a goal. What the
// line under it says is the caller's, because only the caller knows what the
// numbers are of.

// One column: the day, its number, what that day aimed at, and whether there
// is an answer for it at all. A day with no answer is a gap, not a zero.
export type Bar = { date: string; value: number; target: number; has: boolean }

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
                  : `${dayTitle(row.date)}: ${plain(row.value)} of ${plain(row.target)} ${titleUnit}`
              }
            >
              {row.has ? (
                <div
                  className="t-bar absolute inset-x-0 bottom-0 rounded-sm min-[900px]:mx-auto min-[900px]:max-w-9"
                  style={{
                    height: `${share(row.value, ceiling)}%`,
                    background:
                      warnOver && row.value > row.target
                        ? 'var(--pending)'
                        : 'var(--accent)',
                  }}
                />
              ) : (
                <>
                  <div className="absolute inset-0 rounded-sm bg-surface-2 min-[900px]:mx-auto min-[900px]:max-w-9" />
                  <span className="absolute bottom-0 left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-muted" />
                </>
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
        {bars.map((row) => {
          const initial = INITIALS[weekday(row.date)]
          const shown = mondaysOnly && weekday(row.date) !== MONDAY ? '' : initial
          return (
            <span
              key={row.date}
              className={`flex-1 text-center text-[10px] ${
                row.date === todayIso ? '' : 'text-muted'
              }`}
            >
              {shown === '' ? ' ' : shown}
              {/* A short rule under today's letter. An outline around the
                  column itself lands on the dashed target line and reads as
                  part of the chart; this only marks where the reader is. */}
              {highlightToday && row.date === todayIso && (
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
