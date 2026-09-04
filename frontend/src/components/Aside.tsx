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
  waiting,
  onOpenWorkout,
  onOpenMember,
}: {
  me: Me
  refresh: number
  // What the queue holds, already read once above this for the navigation.
  waiting: number
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
        <p className="t-micro mb-2">Today so far</p>
        <div className="t-card grid grid-cols-2 gap-3">
          <Figure
            label="Calories left"
            value={
              strip === null || strip.calories_left === null
                ? '-'
                : Math.round(strip.calories_left).toLocaleString()
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
            label="Last weigh-in"
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
          {me.is_admin && (
            <Figure label="Waiting for review" value={waiting.toLocaleString()} />
          )}
        </div>
      </div>

      <div className="min-h-0">
        <p className="t-micro mb-2">Community</p>
        <div className="t-card">
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
