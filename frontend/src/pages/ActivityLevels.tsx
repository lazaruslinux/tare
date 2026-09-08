import { Check, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import type { Me, RestingInputs, Targets as TargetsRow } from '../api'
import { SaveMarks, useSavedChip } from '../components/SaveMarks'
import { Sheet } from '../components/Sheet'
import { LEVELS, LEVEL_INTRO, asNumber, calText, personalNumber } from '../lib/targets'
import { heightText, round1, weightText } from '../lib/units'
import type { Save } from './Targets'

// Which goal is being typed, if either.
type Goal = 'minutes' | 'steps' | null

// What each of the two is called, and what its field asks for.
const GOALS = {
  minutes: { label: 'Exercise a day', field: 'Minutes', key: 'exercise_minutes_goal' },
  steps: { label: 'Steps a day', field: 'Steps', key: 'step_goal' },
} as const

// The same two-line row the Targets list uses.
function Row({ label, value, onOpen }: { label: string; value: string; onOpen: () => void }) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        <span className="t-nums block truncate text-sm text-muted">{value}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2.5} />
    </button>
  )
}

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
      <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--track)" strokeWidth="9" />
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
  missing,
  busy,
  error,
  onSaveProfile,
  onOpenProfile,
  setup = false,
}: {
  me: Me
  targets: TargetsRow
  // Which of the four details are still missing, so the offer to add them
  // names the gap rather than asking for everything.
  missing: string[]
  busy: boolean
  error: string
  // True inside the guided setup, where only the level and the BMR are shown.
  setup?: boolean
  onSaveProfile: Save
  onOpenProfile: () => void
}) {
  const [saved, markSaved] = useSavedChip()
  const [goal, setGoal] = useState<Goal>(null)
  const [typed, setTyped] = useState('')
  const [savedGoal, markGoalSaved] = useSavedChip()

  const options = new Map(targets.activity_options.map((row) => [row.level, row]))
  const chosen = options.get(targets.activity_level)
  const resting = targets.resting
  const facts = targets.resting_inputs
  const adds = chosen?.adds ?? null
  const exercise = targets.exercise_today

  const pick = async (level: string) => {
    if (await onSaveProfile({ activity_level: level })) markSaved()
  }

  const goals = {
    minutes: targets.exercise_minutes_goal,
    steps: targets.step_goal,
  }

  const openGoal = (which: Exclude<Goal, null>) => {
    setTyped(String(goals[which]))
    setGoal(which)
  }

  const wanted = asNumber(typed)
  const goalDirty = goal !== null && wanted !== null && Math.round(wanted) !== goals[goal]

  const saveGoal = async () => {
    if (goal === null || wanted === null) return
    if (await onSaveProfile({ [GOALS[goal].key]: Math.round(wanted) })) markGoalSaved()
  }

  const slices: Slice[] = [
    { key: 'rest', label: 'BMR', value: resting ?? 0, opacity: 1 },
    { key: 'day', label: 'Your day', value: adds ?? 0, opacity: 0.6 },
    { key: 'exercise', label: 'Exercise (Workouts)', value: exercise, opacity: 0.3 },
  ]
  const total = slices.reduce((sum, slice) => sum + Math.max(slice.value, 0), 0)
  // What the day is budgeted at is the use above with the weight goal taken
  // off or added on. Zero when the budget was typed in by hand.
  const adjustment = targets.breakdown?.adjustment ?? 0
  const budget = Math.round((total + adjustment) / 10) * 10

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Baseline activity level</p>
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
        <p className="t-micro mb-2">BMR</p>
        {resting === null ? (
          <span className="block text-sm text-accent">Add your details</span>
        ) : (
          <>
            <span className="t-nums block text-[1.75rem] leading-none font-semibold">
              {calText(resting)}
              <span className="ml-1 text-sm font-normal text-muted">cal</span>
            </span>
            <p className="t-note mt-2">
              Your BMR or Basal Metabolic Rate is the estimated amount of calories your body
              burns daily, based on age, gender, height, weight, and body fat percentage.
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

      {/* Setup asks for the level alone: the budget only means something once the
          goal step has taken its deficit off it. */}
      {!setup && (
        <>
      <div className="t-card mb-3">
        <p className="t-micro mb-2">Daily calorie budget</p>
        {resting === null ? (
          <button type="button" className="text-sm text-accent" onClick={onOpenProfile}>
            {personalNumber(missing).label}
          </button>
        ) : (
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <Ring slices={slices} total={total} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="t-nums text-2xl font-semibold leading-none">
                  {calText(budget)}
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
              {adjustment !== 0 && (
                <div className="t-row min-h-9 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-accent" />
                  <span className="min-w-0 flex-1 truncate text-muted">Weight goal</span>
                  <span className="t-nums">
                    {adjustment > 0 ? '+' : '\u2212'}
                    {calText(Math.abs(adjustment))}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        <p className="t-note mt-3">Estimated. Real use can vary.</p>
      </div>

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Activity goals</p>
        <Row
          label={GOALS.minutes.label}
          value={`${goals.minutes} min`}
          onOpen={() => openGoal('minutes')}
        />
        <Row
          label={GOALS.steps.label}
          value={goals.steps.toLocaleString()}
          onOpen={() => openGoal('steps')}
        />
      </div>
        </>
      )}

      <Sheet
        open={goal !== null}
        label={goal === null ? '' : GOALS[goal].label}
        onClose={() => setGoal(null)}
      >
        {goal !== null && (
          <>
            <p className="t-micro mb-2">{GOALS[goal].label}</p>
            <label className="t-label" htmlFor="activity-goal">
              {GOALS[goal].field}
            </label>
            <input
              id="activity-goal"
              className="t-input"
              type="number"
              inputMode="numeric"
              step="1"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                className="t-btn t-btn-primary"
                disabled={busy || !goalDirty}
                onClick={() => void saveGoal()}
              >
                Save
              </button>
              <SaveMarks dirty={goalDirty} saved={savedGoal} />
            </div>
          </>
        )}
      </Sheet>

    </>
  )
}
