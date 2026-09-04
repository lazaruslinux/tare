import { useEffect, useState } from 'react'

import { api, errorText, type Me, type WorkoutDetail } from '../api'
import { useTopBar } from '../hooks/useTopBar'
import { dayLabel, today } from '../lib/day'
import { splitsOf } from '../lib/splits'
import { distanceText, distanceUnit, durationText, paceText, round1 } from '../lib/units'
import { RouteLine } from './RouteLine'
import { Switch } from './Switch'

// What another member's sharing left out is absent from the answer, so
// everything drawn from one is asked whether it is there at all.
const present = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined

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
    .filter((row): row is { minute: number; hr: number } => present(row.hr))
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
  back = 'Fitness',
  onBack,
  onOpenMember,
  onChanged,
}: {
  me: Me
  workoutId: number
  // What the way back is called, because this screen is opened from four.
  back?: string
  onBack: () => void
  // Somebody else's workout names who did it, and the name is a way to them.
  onOpenMember?: (userId: number) => void
  // Hiding a workout changes a list that is very likely on screen already.
  onChanged?: () => void
}) {
  const [detail, setDetail] = useState<WorkoutDetail | null>(null)
  const [failed, setFailed] = useState('')
  // What went wrong with the last hide, said under the switch it belongs to.
  const [hideError, setHideError] = useState('')

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
    back: { label: back, onBack },
  })

  if (failed !== '') return <p className="t-error">{failed}</p>
  if (detail === null) return <p className="text-sm text-muted">Loading.</p>

  const pace =
    detail.distance_m === null ? null : paceText(detail.distance_m, detail.duration_s, me.units)
  const route = detail.route ?? null

  // The switch moves at once and moves back if the server says no: a member
  // deciding who sees a morning should not wait on a round trip.
  const setHidden = async (hidden: boolean) => {
    const was = detail.hidden_from_feed
    setHideError('')
    setDetail({ ...detail, hidden_from_feed: hidden })
    try {
      await api(`/workouts/${detail.id}`, {
        method: 'PATCH',
        body: { hidden_from_feed: hidden },
      })
      onChanged?.()
    } catch (failure) {
      setDetail({ ...detail, hidden_from_feed: was })
      setHideError(errorText(failure))
    }
  }

  return (
    <>
      <div className="t-card mb-3">
        <p className="mb-2 text-sm text-muted">
          {!detail.mine && onOpenMember !== undefined && (
            <>
              <button
                type="button"
                className="underline decoration-line underline-offset-2"
                onClick={() => onOpenMember(detail.user_id)}
              >
                {detail.display_name}
              </button>
              {' · '}
            </>
          )}
          {dayLabel(detail.date, today(me.timezone))}
          {detail.indoor ? ' · Indoors' : ''}
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Time" value={durationText(detail.duration_s)} />
          {detail.distance_m !== null && (
            <Stat label="Distance" value={distanceText(detail.distance_m, me.units)} />
          )}
          {present(detail.kcal) && <Stat label="Calories" value={`${detail.kcal} cal`} />}
          {pace !== null && <Stat label="Pace" value={pace} />}
          {present(detail.avg_hr) && (
            <Stat label="Average heart rate" value={`${detail.avg_hr} bpm`} />
          )}
          {present(detail.max_hr) && <Stat label="Highest" value={`${detail.max_hr} bpm`} />}
          {present(detail.elevation_gain_m) && (
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
        {(detail.flags ?? []).map((flag) => (
          <p key={flag} className="mt-3 text-xs text-muted">
            {FLAG_TEXT[flag] ?? 'One of these numbers looked unusual to Tare.'}
          </p>
        ))}
      </div>

      {route !== null && route.length > 1 && (
        <div className="t-card mb-3">
          <p className="t-micro mb-2">Route</p>
          <RouteLine points={route} />
          <p className="mt-1 text-xs text-muted">
            The start and the end are left off every route Tare keeps.
          </p>
        </div>
      )}

      <HeartLine detail={detail} />
      <Splits detail={detail} me={me} />

      {detail.mine && (
        <div className="t-card mb-3">
          <Switch
            label="Show in the community feed"
            note="Members see the activity, time, distance and route line. Heart rate, calories and route follow your Sharing settings."
            checked={!detail.hidden_from_feed}
            onChange={(next) => setHidden(!next)}
          />
          {hideError && <p className="t-error mt-2">{hideError}</p>}
        </div>
      )}
    </>
  )
}
