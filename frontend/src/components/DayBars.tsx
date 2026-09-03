import type { DayRow } from '../api'
import { calText } from '../lib/targets'

// A run of days as bars: one column a day, oldest on the left, today on the
// right. Drawn by hand out of two divs a column, because a chart library for
// seven numbers is a library nobody reads.

// The one letter under each bar. Read off the date as UTC, which is the
// calendar day the server already worked out in the member's own zone.
const INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONDAY = 1

const weekday = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay()

// A share of the tallest thing on the chart, as a percentage of the block.
const share = (value: number, ceiling: number): number =>
  ceiling <= 0 ? 0 : Math.min(Math.max(value / ceiling, 0), 1) * 100

export function DayBars({
  days,
  todayIso,
  height = 56,
  // Twenty-eight letters in a row is a smudge, so the long view names the
  // weeks instead: one letter a Monday.
  mondaysOnly = false,
}: {
  days: DayRow[]
  todayIso: string
  height?: number
  mondaysOnly?: boolean
}) {
  const logged = days.filter((row) => row.logged)
  const ceiling = Math.max(
    ...days.map((row) => Math.max(row.budget, row.calories)),
    1
  )
  // One line across the block when every day is read against the same number,
  // which is what the day view does today. Otherwise each bar carries its own.
  const budget = days.length === 0 ? 0 : days[days.length - 1].budget
  const oneBudget = days.every((row) => row.budget === budget)
  const gap = days.length > 14 ? 'gap-[2px]' : 'gap-1'
  const average =
    logged.length === 0
      ? 0
      : Math.round(logged.reduce((sum, row) => sum + row.calories, 0) / logged.length)

  return (
    <div>
      <div className="relative" style={{ height: `${height}px` }} aria-hidden="true">
        <div className={`flex h-full items-end ${gap}`}>
          {days.map((row) => (
            <div key={row.date} className="relative h-full flex-1">
              {row.logged ? (
                <div
                  className="absolute inset-x-0 bottom-0 rounded-sm"
                  style={{
                    height: `${share(row.calories, ceiling)}%`,
                    background:
                      row.calories > row.budget ? 'var(--pending)' : 'var(--accent)',
                  }}
                />
              ) : (
                <>
                  <div className="absolute inset-0 rounded-sm bg-surface-2" />
                  <span className="absolute bottom-0 left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-muted" />
                </>
              )}
              {!oneBudget && (
                <div
                  className="absolute inset-x-0 border-t border-dashed border-line-strong"
                  style={{ bottom: `${share(row.budget, ceiling)}%` }}
                />
              )}
            </div>
          ))}
        </div>
        {oneBudget && budget > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line-strong"
            style={{ bottom: `${share(budget, ceiling)}%` }}
          />
        )}
      </div>

      <div className={`mt-1 flex ${gap}`}>
        {days.map((row) => {
          const initial = INITIALS[weekday(row.date)]
          const shown = mondaysOnly && weekday(row.date) !== MONDAY ? '' : initial
          return (
            <span
              key={row.date}
              className={`flex-1 text-center text-[10px] ${
                row.date === todayIso ? '' : 'text-muted'
              }`}
            >
              {shown === '' ? ' ' : shown}
            </span>
          )
        })}
      </div>

      <p className="mt-2 text-xs text-muted">
        {logged.length === 0 ? (
          'Log a few days to see them here.'
        ) : (
          <span className="t-nums">
            Average {calText(average)} cal a day · budget {calText(budget)}
          </span>
        )}
      </p>
    </div>
  )
}
