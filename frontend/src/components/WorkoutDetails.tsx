import { useEffect, useState } from 'react'

import { api, errorText, type Me, type WorkoutDetail } from '../api'
import { useTopBar } from '../hooks/useTopBar'
import { dayLabel, today } from '../lib/day'
import { splitsOf } from '../lib/splits'
import { distanceText, distanceUnit, durationText, paceText, round1 } from '../lib/units'
import { RouteLine } from './RouteLine'

// The words for what looked odd about a session. A flag is never a refusal:
// the workout is here, and this is Tare saying it does not quite believe one
// of the numbers on it.
const FLAG_TEXT: Record<string, string> = {
  impossible_pace: 'This one is faster than Tare expected. The numbers are as your phone sent them.',
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="t-micro mb-0.5">{label}</p>
      <p className="t-nums text-lg">{value}</p>
    </div>
  )
}

function HeartLine({ detail }: { detail: WorkoutDetail }) {
  const beats = detail.samples
    .map((row) => ({ minute: row.minute, hr: row.hr_avg ?? row.hr_max ?? row.hr_min }))
    .filter((row): row is { minute: number; hr: number } => row.hr !== null)
  if (beats.length < 2) return null

  const width = 320
  const height = 96
  const low = Math.min(...beats.map((row) => row.hr))
  const high = Math.max(...beats.map((row) => row.hr))
  const span = Math.max(high - low, 1)
  const last = Math.max(...beats.map((row) => row.minute), 1)
  const path = beats
    .map((row, index) => {
      const x = (row.minute / last) * width
      const y = height - ((row.hr - low) / span) * (height - 8) - 4
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <div className="t-card mb-3">
      <p className="t-micro mb-2">Heart rate</p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Heart rate from ${low} to ${high} beats a minute`}
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-accent"
        />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span className="t-nums">{low}</span>
        <span className="t-nums">{high}</span>
      </div>
    </div>
  )
}

function Splits({ detail, me }: { detail: WorkoutDetail; me: Me }) {
  const rows = splitsOf(detail.samples, me.units)
  if (rows.length === 0) return null
  const unit = distanceUnit(me.units)
  return (
    <div className="t-card mb-3">
      <p className="t-micro mb-2">Splits</p>
      {rows.map((split) => (
        <div key={split.index} className="t-row min-h-9 text-sm">
          <span className="flex-1">
            {split.whole
              ? `${split.index} ${unit}`
              : `${round1(split.index - 1 + split.distance / (me.units === 'metric' ? 1000 : 1609.344))} ${unit}`}
          </span>
          <span className="t-nums text-muted">
            {durationText(split.seconds)}
            {split.hr === null ? '' : ` · ${split.hr} bpm`}
          </span>
        </div>
      ))}
    </div>
  )
}

export function WorkoutDetails({
  me,
  workoutId,
  onBack,
}: {
  me: Me
  workoutId: number
  onBack: () => void
}) {
  const [detail, setDetail] = useState<WorkoutDetail | null>(null)
  const [failed, setFailed] = useState('')

  useEffect(() => {
    let alive = true
    api<WorkoutDetail>(`/workouts/${workoutId}`)
      .then((row) => alive && setDetail(row))
      .catch((failure) => alive && setFailed(errorText(failure)))
    return () => {
      alive = false
    }
  }, [workoutId])

  useTopBar({
    title: detail?.activity ?? 'Workout',
    back: { label: 'Fitness', onBack },
  })

  if (failed !== '') return <p className="t-error">{failed}</p>
  if (detail === null) return <p className="text-sm text-muted">Loading.</p>

  const pace =
    detail.distance_m === null ? null : paceText(detail.distance_m, detail.duration_s, me.units)

  return (
    <>
      <div className="t-card mb-3">
        <p className="mb-2 text-sm text-muted">
          {dayLabel(detail.date, today(me.timezone))}
          {detail.indoor ? ' · Indoors' : ''}
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Time" value={durationText(detail.duration_s)} />
          {detail.distance_m !== null && (
            <Stat label="Distance" value={distanceText(detail.distance_m, me.units)} />
          )}
          {detail.kcal !== null && <Stat label="Calories" value={`${detail.kcal} cal`} />}
          {pace !== null && <Stat label="Pace" value={pace} />}
          {detail.avg_hr !== null && (
            <Stat label="Average heart rate" value={`${detail.avg_hr} bpm`} />
          )}
          {detail.max_hr !== null && <Stat label="Highest" value={`${detail.max_hr} bpm`} />}
          {detail.elevation_gain_m !== null && (
            <Stat
              label="Climb"
              value={
                me.units === 'metric'
                  ? `${Math.round(detail.elevation_gain_m)} m`
                  : `${Math.round(detail.elevation_gain_m / 0.3048)} ft`
              }
            />
          )}
        </div>
        {detail.flags.map((flag) => (
          <p key={flag} className="mt-3 text-xs text-muted">
            {FLAG_TEXT[flag] ?? 'One of these numbers looked unusual to Tare.'}
          </p>
        ))}
      </div>

      {detail.route !== null && detail.route.length > 1 && (
        <div className="t-card mb-3">
          <p className="t-micro mb-2">Route</p>
          <RouteLine points={detail.route} />
          <p className="mt-1 text-xs text-muted">
            The start and the end are left off every route Tare keeps.
          </p>
        </div>
      )}

      <HeartLine detail={detail} />
      <Splits detail={detail} me={me} />
    </>
  )
}
