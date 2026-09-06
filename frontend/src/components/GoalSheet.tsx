import { useEffect, useState } from 'react'

import { api, errorText, type DayGoals, type Me } from '../api'
import { Sheet } from './Sheet'
import { dayLabel, today } from '../lib/day'
import { asNumber } from '../lib/targets'

// One day's own step and exercise goals. The usual pair is set once on
// Activity Levels; this is for the day somebody wanted something else of, and
// it writes nothing about any other day.

// Only what was changed is sent. A figure left alone is left alone on the
// server too, so saving a new step goal never pins the exercise goal to
// whatever it happened to be today.
type Patch = { steps?: number | null; exercise_minutes?: number | null }

export function GoalSheet({
  me,
  date,
  onClose,
  onSaved,
}: {
  me: Me
  // The day being aimed at. Every way in so far hands over today.
  date: string
  onClose: () => void
  onSaved: () => void
}) {
  const [goals, setGoals] = useState<DayGoals | null>(null)
  const [steps, setSteps] = useState('')
  const [minutes, setMinutes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const todayIso = today(me.timezone)
  const heading =
    date === todayIso ? 'Goals for today' : `Goals for ${dayLabel(date, todayIso)}`

  useEffect(() => {
    let alive = true
    api<DayGoals>(`/fitness/goals?date=${date}`)
      .then((row) => {
        if (!alive) return
        setGoals(row)
        setSteps(String(row.steps))
        setMinutes(String(row.exercise_minutes))
      })
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [date])

  const wantedSteps = asNumber(steps)
  const wantedMinutes = asNumber(minutes)
  const patch: Patch = {}
  if (goals !== null && wantedSteps !== null && Math.round(wantedSteps) !== goals.steps) {
    patch.steps = Math.round(wantedSteps)
  }
  if (
    goals !== null &&
    wantedMinutes !== null &&
    Math.round(wantedMinutes) !== goals.exercise_minutes
  ) {
    patch.exercise_minutes = Math.round(wantedMinutes)
  }
  const dirty = Object.keys(patch).length > 0

  const write = async (body: Patch) => {
    setSaving(true)
    setError('')
    try {
      await api<DayGoals>(`/fitness/goals/${date}`, { method: 'PUT', body })
      onSaved()
    } catch (failure) {
      setError(errorText(failure))
      setSaving(false)
    }
  }

  return (
    <Sheet open label={heading} center onClose={onClose}>
      <p className="t-micro mb-2">{heading}</p>
      {goals === null ? (
        error === '' ? (
          <p className="text-sm text-muted">Loading.</p>
        ) : (
          <p className="t-error">{error}</p>
        )
      ) : (
        <>
          <div className="mb-3">
            <label className="t-label" htmlFor="goal-steps">
              Steps
            </label>
            <input
              id="goal-steps"
              className="t-input"
              type="number"
              inputMode="numeric"
              step="1"
              value={steps}
              onChange={(event) => setSteps(event.target.value)}
            />
          </div>

          <div className="mb-3">
            <label className="t-label" htmlFor="goal-minutes">
              Exercise minutes
            </label>
            <input
              id="goal-minutes"
              className="t-input"
              type="number"
              inputMode="numeric"
              step="1"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </div>

          <p className="t-note">For this day only. Your usual goals stay on Activity Levels.</p>

          {error !== '' && <p className="t-error mt-3">{error}</p>}

          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              className="t-btn t-btn-primary"
              disabled={saving || !dirty}
              onClick={() => void write(patch)}
            >
              Save
            </button>
            {goals.overridden && (
              <button
                type="button"
                className="t-tap44 text-sm text-accent"
                disabled={saving}
                onClick={() => void write({ steps: null, exercise_minutes: null })}
              >
                Use my usual goals
              </button>
            )}
          </div>
        </>
      )}
    </Sheet>
  )
}
