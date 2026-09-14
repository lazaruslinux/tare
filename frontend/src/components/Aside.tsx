import { useEffect, useState } from 'react'

import { api, type Me, type TodayStrip } from '../api'
import { useAsideSlotNode } from '../lib/asideSlot'
import { dayLabel, today } from '../lib/day'
import { weightText } from '../lib/units'
import { MiniMonth } from './calendar/MiniMonth'
import { Feed } from './Feed'
import { type Page } from './TabBar'

// The right-hand column: where today stands, and what the other members have
// been doing. The Dashboard already says today's numbers in its own cards, so
// on that tab the top block is the month instead; every other tab keeps the
// figures, and nothing on the column is said twice on one screen. A screen
// with something of its own to put there fills the slot, and that wins.

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="t-micro mb-0.5">{label}</p>
      <p className="t-nums text-sm">{value}</p>
      {note !== undefined && <p className="text-xs text-muted">{note}</p>}
    </div>
  )
}

export function Aside({
  me,
  page,
  refresh,
  onOpenWorkout,
  onOpenMember,
  onOpenCalendarDay,
}: {
  me: Me
  // Which tab is underneath, which decides what the top block of the column
  // is. Nothing else on it changes with the screen.
  page: Page
  refresh: number
  onOpenWorkout: (id: number) => void
  onOpenMember: (userId: number) => void
  // A day picked off the month, opened on the calendar itself.
  onOpenCalendarDay: (date: string) => void
}) {
  const [strip, setStrip] = useState<TodayStrip | null>(null)
  const todayIso = today(me.timezone)
  const slot = useAsideSlotNode()
  const month = page === 'dashboard'

  useEffect(() => {
    if (month) return
    let alive = true
    api<TodayStrip>('/feed/today')
      .then((row) => alive && setStrip(row))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [refresh, month])

  return (
    <>
      {slot !== null ? (
        slot
      ) : month ? (
        <MiniMonth me={me} refresh={refresh} onOpenDay={onOpenCalendarDay} />
      ) : (
        <div>
          <p className="t-micro mb-2">Today's numbers</p>
          <div className="t-card grid grid-cols-2 gap-3">
            <Figure
              label="Consumed"
              value={
                strip === null || strip.calories_eaten === null
                  ? '-'
                  : `${Math.round(strip.calories_eaten).toLocaleString()} cal`
              }
            />
            <Figure
              label="Steps"
              value={
                strip === null || strip.steps === null
                  ? '-'
                  : Math.round(strip.steps).toLocaleString()
              }
            />
            <Figure
              label="Activity"
              value={
                strip === null || strip.exercise_min === null
                  ? '-'
                  : `${Math.round(strip.exercise_min).toLocaleString()} min`
              }
            />
            <Figure
              label="Weight"
              value={
                strip === null || strip.latest_weight_kg === null
                  ? '-'
                  : weightText(strip.latest_weight_kg, me.units)
              }
              note={
                strip === null || strip.latest_weight_date === null
                  ? undefined
                  : dayLabel(strip.latest_weight_date, todayIso)
              }
            />
            <Figure
              label="Contributions"
              value={strip === null ? '-' : strip.contributions.toLocaleString()}
              note={
                strip !== null && strip.pending > 0 ? `${strip.pending} pending` : undefined
              }
            />
          </div>
        </div>
      )}

      {/* The feed takes what is left of the column and scrolls inside its own
          card, so Show more never pushes the column past the window. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="t-micro mb-2">Community</p>
        <div className="t-card min-h-[12rem] flex-1 overflow-y-auto">
          <Feed
            me={me}
            refresh={refresh}
            onOpenWorkout={onOpenWorkout}
            onOpenMember={onOpenMember}
          />
        </div>
      </div>
    </>
  )
}
