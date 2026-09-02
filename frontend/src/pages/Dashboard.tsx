import { useEffect, useState } from 'react'

import { api, errorText, type DiaryDay, type Me } from '../api'
import { HEADLINE, nutrientText } from '../components/NutritionLabel'
import { useTopBar } from '../hooks/useTopBar'
import { today } from '../lib/day'

export function Dashboard({ me, refresh }: { me: Me; refresh: number }) {
  const [day, setDay] = useState<DiaryDay | null>(null)
  const [error, setError] = useState('')

  // The wordmark is the header here, and the rail's own name takes over
  // from it at the width the rail appears.
  useTopBar({ title: 'Dashboard', left: 'wordmark' })

  useEffect(() => {
    let alive = true
    api<DiaryDay>(`/diary/day?date=${today(me.timezone)}`)
      .then((loaded) => alive && setDay(loaded))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [me.timezone, refresh])

  return (
    <>

      {error && <p className="t-error mb-3">{error}</p>}

      <div className="t-card mb-3">
        <p className="t-micro mb-1">Today</p>
        {/* What has been eaten, and nothing about what should have been: there
            is no target to fall short of yet. */}
        <span className="t-nums block text-4xl font-semibold leading-tight">
          {day === null ? '-' : nutrientText('calories', day.totals.calories)}
        </span>
        <span className="block text-xs text-muted">Calories eaten</span>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {HEADLINE.slice(1).map((fact) => (
            <div key={fact.key}>
              <span className="t-nums block text-lg font-semibold">
                {day === null ? '-' : nutrientText(fact.key, day.totals[fact.key])}
                <span className="text-sm font-normal text-muted">{fact.unit}</span>
              </span>
              <span className="block text-xs text-muted">{fact.label}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
