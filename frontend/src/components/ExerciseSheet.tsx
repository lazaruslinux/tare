import { useEffect, useState, type FormEvent } from 'react'

import {
  api,
  errorText,
  type Activity,
  type EffortLevel,
  type Exercise,
  type Profile,
} from '../api'
import { Sheet } from './Sheet'

// The three efforts in the order they read, and the words for them. An
// activity offers only the ones it has a published figure for, so these are
// labels rather than a list of choices.
const EFFORT_LABEL: Record<EffortLevel, string> = {
  light: 'Light',
  moderate: 'Moderate',
  vigorous: 'Vigorous',
}

// What a workout is credited against when nobody has weighed in yet, and the
// same figure the server falls back to.
const ASSUMED_KG = 70

// The credit itself, previewed here and worked out again on the server: the
// value over resting, for that long, at that weight.
// The longest single entry the server takes.
const MAX_MINUTES = 720

const credit = (met: number, kg: number, minutes: number): number =>
  ((met - 1) * 3.5 * kg) / 200 * minutes

export function ExerciseSheet({
  date,
  onClose,
  onSaved,
}: {
  // The day it counts against. The Journal hands over the day on screen, and
  // everywhere else hands over today.
  date: string
  onClose: () => void
  onSaved: () => void
}) {
  const [catalogue, setCatalogue] = useState<Activity[]>([])
  const [weightKg, setWeightKg] = useState<number | null>(null)
  const [day, setDay] = useState(date)
  const [chosen, setChosen] = useState('')
  const [effort, setEffort] = useState<EffortLevel>('moderate')
  const [minutes, setMinutes] = useState('30')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    api<Activity[]>('/health/activities')
      .then((rows) => alive && setCatalogue(rows))
      .catch((failure) => alive && setError(errorText(failure)))
    // The weight the preview is worked at. Null is not an error here: it is
    // the reason the sheet says the figure is a rough one.
    api<Profile>('/health/profile')
      .then((profile) => alive && setWeightKg(profile.latest_weight_kg))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const activity = catalogue.find((row) => row.key === chosen) ?? null
  const offered = activity?.efforts ?? []
  const picked = offered.find((row) => row.effort === effort) ?? offered[0] ?? null
  const length = Number(minutes)
  const lengthOk = Number.isFinite(length) && length >= 1 && length <= MAX_MINUTES
  const about =
    picked === null || !Number.isFinite(length) || length <= 0
      ? null
      : Math.round(credit(picked.met, weightKg ?? ASSUMED_KG, length) / 10) * 10

  // Picking an activity that does not offer the chosen effort moves to one it
  // does, so the chips never all read as unchosen.
  const pick = (key: string) => {
    setChosen(key)
    const efforts = catalogue.find((row) => row.key === key)?.efforts ?? []
    if (!efforts.some((row) => row.effort === effort)) {
      setEffort(efforts[0]?.effort ?? 'moderate')
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (activity === null || picked === null) {
      setError('Pick what you did.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api<Exercise>('/health/exercise', {
        method: 'POST',
        body: {
          date_for: day,
          activity: activity.key,
          effort: picked.effort,
          minutes: Math.round(length),
        },
      })
      onSaved()
    } catch (failure) {
      setError(errorText(failure))
      setSaving(false)
    }
  }

  return (
    <Sheet open label="Exercise" tall onClose={onClose}>
      <form onSubmit={submit}>
        <p className="mb-3 text-base font-semibold">Exercise</p>

        <div className="mb-3">
          <label className="t-label" htmlFor="exercise-activity">
            What did you do?
          </label>
          <select
            id="exercise-activity"
            className="t-input"
            value={chosen}
            onChange={(event) => pick(event.target.value)}
          >
            <option value="">Pick one</option>
            {catalogue.map((row) => (
              <option key={row.key} value={row.key}>
                {row.name}
              </option>
            ))}
          </select>
        </div>

        {offered.length > 0 && (
          <div className="mb-3">
            <p className="t-label">How hard?</p>
            <div className="flex flex-wrap gap-2">
              {offered.map((row) => (
                <button
                  key={row.effort}
                  type="button"
                  aria-pressed={picked?.effort === row.effort}
                  className="t-chip t-tap44 aria-pressed:border-accent aria-pressed:text-text"
                  onClick={() => setEffort(row.effort)}
                >
                  {EFFORT_LABEL[row.effort]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-3">
          <label className="t-label" htmlFor="exercise-minutes">
            Minutes
          </label>
          <input
            id="exercise-minutes"
            className="t-input"
            type="number"
            inputMode="numeric"
            step="1"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
          {minutes !== '' && !lengthOk && (
            <p className="mt-1 text-xs text-muted">Between 1 and {MAX_MINUTES} minutes.</p>
          )}
        </div>

        <div className="mb-3">
          <label className="t-label" htmlFor="exercise-date">
            Day
          </label>
          <input
            id="exercise-date"
            className="t-input"
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
        </div>

        {about !== null && (
          <p className="text-sm text-muted">
            Exercise added back: about {about} cal.
            {weightKg === null && ' Add a weight for a better estimate.'}
          </p>
        )}

        {error && <p className="t-error mt-3">{error}</p>}

        <button className="t-btn t-btn-primary mt-4 w-full" type="submit" disabled={saving || !lengthOk}>
          Add
        </button>
      </form>
    </Sheet>
  )
}
