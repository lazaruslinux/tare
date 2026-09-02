import { Check } from 'lucide-react'
import { useState } from 'react'

import type { Me, RestingInputs, Targets as TargetsRow } from '../api'
import { ExerciseSheet } from '../components/ExerciseSheet'
import { SaveMarks, useSavedChip } from '../components/SaveMarks'
import { today } from '../lib/day'
import { LEVELS, LEVEL_INTRO, calText } from '../lib/targets'
import { heightText, round1, weightText } from '../lib/units'
import type { Save } from './Targets'

// The ring, drawn by hand: one circle whose stroke is cut into three arcs. No
// library, and nothing that moves.
const RADIUS = 42
const ROUND = 2 * Math.PI * RADIUS

// The three parts of a day, told apart by how much of the accent each keeps.
// One hue rather than three, because three greens at this size read as one.
type Slice = { key: string; label: string; value: number; opacity: number }

function Ring({ slices, total }: { slices: Slice[]; total: number }) {
  let start = 0
  return (
    <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90" aria-hidden="true">
      <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--line-strong)" strokeWidth="9" />
      {slices.map((slice) => {
        const share = total <= 0 ? 0 : Math.max(slice.value, 0) / total
        const length = share * ROUND
        const offset = -start * ROUND
        start += share
        return (
          <circle
            key={slice.key}
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke="var(--accent)"
            strokeOpacity={slice.opacity}
            strokeWidth="9"
            strokeDasharray={`${length} ${ROUND - length}`}
            strokeDashoffset={offset}
          />
        )
      })}
    </svg>
  )
}

// What the resting figure was worked out from, in the member's own units and
// in one line. The body fat part is there only when it is the reading the
// figure really used.
function factsLine(facts: RestingInputs, units: Me['units']): string {
  const parts = [
    `${facts.age} years`,
    facts.sex === 'male' ? 'Male' : 'Female',
    heightText(facts.height_cm, units),
    weightText(facts.weight_kg, units),
  ]
  if (facts.body_fat_pct !== null) parts.push(`${round1(facts.body_fat_pct)}% body fat`)
  return parts.join(' · ')
}

export function ActivityLevels({
  me,
  targets,
  busy,
  error,
  onSaved,
  onSaveProfile,
  onOpenProfile,
}: {
  me: Me
  targets: TargetsRow
  busy: boolean
  error: string
  onSaved: () => void
  onSaveProfile: Save
  onOpenProfile: () => void
}) {
  const [logging, setLogging] = useState(false)
  const [saved, markSaved] = useSavedChip()

  const options = new Map(targets.activity_options.map((row) => [row.level, row]))
  const chosen = options.get(targets.activity_level)
  const resting = targets.resting
  const facts = targets.resting_inputs
  const adds = chosen?.adds ?? null
  const exercise = targets.exercise_today

  const pick = async (level: string) => {
    if (await onSaveProfile({ activity_level: level })) markSaved()
  }

  const slices: Slice[] = [
    { key: 'rest', label: 'At rest', value: resting ?? 0, opacity: 1 },
    { key: 'day', label: 'Your day', value: adds ?? 0, opacity: 0.6 },
    { key: 'exercise', label: 'Exercise', value: exercise, opacity: 0.3 },
  ]
  const total = slices.reduce((sum, slice) => sum + Math.max(slice.value, 0), 0)

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Baseline Activity Level</p>
        <p className="t-note mb-3">{LEVEL_INTRO}</p>
        {LEVELS.map((level) => {
          const option = options.get(level.value)
          return (
            <button
              key={level.value}
              type="button"
              aria-pressed={targets.activity_level === level.value}
              disabled={busy}
              className="t-option"
              onClick={() => void pick(level.value)}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{level.label}</span>
                <span className="block text-xs text-muted">{level.note}</span>
                <span className="block text-xs text-muted">Example: {level.example}</span>
                {option?.adds !== null && option !== undefined && (
                  <span className="t-nums mt-1 block text-xs">
                    adds about {calText(option.adds)} cal
                  </span>
                )}
              </span>
              {targets.activity_level === level.value && (
                <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.5} />
              )}
            </button>
          )
        })}
        <div className="mt-3 flex items-center gap-3">
          {busy ? (
            <span className="text-xs text-muted">Saving</span>
          ) : (
            <SaveMarks dirty={false} saved={saved} />
          )}
        </div>
      </div>

      {/* The whole card is the way to the details it is worked out from, the
          same as the row it replaces. */}
      <button type="button" className="t-card mb-3 block w-full text-left" onClick={onOpenProfile}>
        <p className="t-micro mb-2">At rest</p>
        {resting === null ? (
          <span className="block text-sm text-accent">Add your details</span>
        ) : (
          <>
            <span className="t-nums block text-[1.75rem] leading-none font-semibold">
              {calText(resting)}
              <span className="ml-1 text-sm font-normal text-muted">cal</span>
            </span>
            <p className="t-note mt-2">
              The least energy your body needs just to run, worked out from your age, sex,
              height, weight and body fat. Sometimes called basal metabolic rate.
            </p>
            {facts !== null && (
              <p className="t-nums mt-2 text-xs text-muted">{factsLine(facts, me.units)}</p>
            )}
            {targets.uses_body_fat && (
              <p className="mt-1 text-xs text-muted">Uses your recent body fat reading</p>
            )}
          </>
        )}
      </button>

      <div className="t-card mb-3">
        <p className="t-micro mb-2">About what you use today</p>
        {resting === null ? (
          <button type="button" className="text-sm text-accent" onClick={onOpenProfile}>
            Add your details for a personal number
          </button>
        ) : (
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <Ring slices={slices} total={total} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="t-nums text-2xl font-semibold leading-none">
                  {calText(Math.round(total / 10) * 10)}
                </span>
                <span className="text-xs text-muted">cal</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              {slices.map((slice) => (
                <div key={slice.key} className="t-row min-h-9 text-sm">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent"
                    style={{ opacity: slice.opacity }}
                  />
                  <span className="min-w-0 flex-1 truncate text-muted">{slice.label}</span>
                  <span className="t-nums">
                    {calText(slice.value)}
                    <span className="text-muted">
                      {' '}
                      · {total <= 0 ? 0 : Math.round((slice.value / total) * 100)}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="t-note mt-3">
          This is an estimate. What your body really uses can be a few hundred calories
          either side of it.
        </p>

        <button
          type="button"
          className="t-row w-full text-left"
          onClick={() => setLogging(true)}
        >
          <span className="min-w-0 flex-1 text-sm">Exercise today</span>
          <span className="t-nums shrink-0 text-sm text-muted">
            {exercise > 0 ? `${calText(exercise)} cal` : 'Log exercise'}
          </span>
        </button>
      </div>

      {logging && (
        <ExerciseSheet
          date={today(me.timezone)}
          onClose={() => setLogging(false)}
          onSaved={() => {
            setLogging(false)
            onSaved()
          }}
        />
      )}
    </>
  )
}
