import { useEffect, useState } from 'react'

import { api, type Me, type TodayStrip } from '../api'
import { dayLabel, today } from '../lib/day'
import { weightText } from '../lib/units'
import { Feed } from './Feed'

// The right-hand column, and the same one on every tab: where today stands,
// and what the other members have been doing. It never changes with the
// screen beside it, so nothing on it has to be read twice.

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
  refresh,
  onOpenWorkout,
  onOpenMember,
}: {
  me: Me
  refresh: number
  onOpenWorkout: (id: number) => void
  onOpenMember: (userId: number) => void
}) {
  const [strip, setStrip] = useState<TodayStrip | null>(null)
  const todayIso = today(me.timezone)

  useEffect(() => {
    let alive = true
    api<TodayStrip>('/feed/today')
      .then((row) => alive && setStrip(row))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [refresh])

  return (
    <>
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
            label="Exercise"
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
