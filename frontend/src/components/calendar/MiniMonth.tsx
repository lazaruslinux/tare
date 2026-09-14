import { useEffect, useState } from 'react'

import { calendarDays, type Me, type Occurrence } from '../../api'
import { dateText } from '../../lib/clock'
import { monthGrid, monthOf, monthTitle } from '../../lib/calendar'
import { today } from '../../lib/day'
import { tintOf } from './DayTimeline'

// The month at a glance, in the right-hand column of the Dashboard. It says
// nothing a cell cannot hold: which day it is, and which days have something
// on them. Tapping one opens the calendar there.

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
// How many marks a cell carries before it stops counting.
const DOTS = 3

export function MiniMonth({
  me,
  refresh,
  onOpenDay,
}: {
  me: Me
  // The app-wide change tick: the month is read again on every bump.
  refresh: number
  onOpenDay: (date: string) => void
}) {
  const todayIso = today(me.timezone)
  const anchor = monthOf(todayIso)
  const weeks = monthGrid(anchor.year, anchor.month)
  const first = weeks[0][0].date
  const last = weeks[5][6].date
  const [days, setDays] = useState<Map<string, Occurrence[]>>(new Map())

  useEffect(() => {
    let alive = true
    calendarDays(first, last)
      .then((loaded) => {
        if (!alive) return
        setDays(new Map(loaded.days.map((one) => [one.date, one.items])))
      })
      // A column beside the page says nothing when it cannot be read. The
      // calendar itself is where a failure is worth a sentence.
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [first, last, refresh])

  return (
    <div>
      <p className="t-micro mb-2">Calendar</p>
      <div className="t-card">
        <p className="t-card-title mb-2">{monthTitle(anchor.year, anchor.month)}</p>
        <div className="t-cal-mini">
          {DOW.map((letter, index) => (
            <span key={index} className="t-cal-mini-dow">
              {letter}
            </span>
          ))}
          {weeks.flat().map((cell) => {
            const items = days.get(cell.date) ?? []
            return (
              <button
                key={cell.date}
                type="button"
                className={`t-cal-mini-cell${cell.spillover ? ' t-cal-mini-dim' : ''}`}
                aria-label={`Open ${dateText(cell.date)}`}
                onClick={() => onOpenDay(cell.date)}
              >
                <span
                  className={`t-cal-mini-day${cell.date === todayIso ? ' t-cal-mini-today' : ''}`}
                >
                  <span className="t-nums">{cell.day}</span>
                  <span className="t-cal-mini-dots">
                    {items.slice(0, DOTS).map((item) => (
                      <span
                        key={`${item.id}-${item.occurrence_date}`}
                        style={{ background: tintOf(item) }}
                      />
                    ))}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
