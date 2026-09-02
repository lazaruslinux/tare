import { CalendarDays, Check, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { api, type Me, type Profile as ProfileRow, type Targets as TargetsRow } from '../api'
import { MeasurementsSheet } from '../components/MeasurementsSheet'
import { SaveMarks, useSavedChip } from '../components/SaveMarks'
import { Sheet } from '../components/Sheet'
import { today } from '../lib/day'
import {
  GOAL_LABEL,
  GOALS,
  GOOD_TO_KNOW,
  PACE_CAVEAT,
  PACE_NOTES,
  RATE_LABEL,
  asNumber,
  monthText,
  notesFor,
  rateText,
} from '../lib/targets'
import { weightFrom, weightIn, weightText, weightUnit } from '../lib/units'
import type { Save } from './Targets'

// Which sheet is open over the screen, if any.
type Open = 'weight' | 'goal' | 'pace' | null

function Tile({
  label,
  value,
  muted,
  onOpen,
}: {
  label: string
  value: string
  muted?: boolean
  onOpen?: () => void
}) {
  const inside = (
    <>
      <span className="t-micro mb-1 block">{label}</span>
      <span className={`block text-lg font-semibold leading-tight ${muted ? 'text-muted' : ''}`}>
        {value}
      </span>
    </>
  )
  if (onOpen === undefined) return <div className="t-card">{inside}</div>
  return (
    <button type="button" className="t-card w-full text-left" onClick={onOpen}>
      {inside}
    </button>
  )
}

// The same two-line row the Targets list uses: the value sits under its label,
// so a long one ("Lose weight, Steady, 1.1 lb a week") never squeezes the label.
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

export function WeightGoal({
  me,
  targets,
  profile,
  busy,
  error,
  onSaved,
  onSaveProfile,
  onSaveTargets,
}: {
  me: Me
  targets: TargetsRow
  profile: ProfileRow | null
  busy: boolean
  error: string
  onSaved: () => void
  onSaveProfile: Save
  onSaveTargets: Save
}) {
  const units = me.units
  const [open, setOpen] = useState<Open>(null)
  const [goalWeight, setGoalWeight] = useState(
    targets.goal_weight_kg === null ? '' : String(weightIn(targets.goal_weight_kg, units))
  )
  const [savedGoal, markGoalSaved] = useSavedChip()
  const [savedPace, markPaceSaved] = useSavedChip()

  const typed = asNumber(goalWeight)
  const goalDirty =
    (typed === null ? null : weightFrom(typed, units)) !==
    (targets.goal_weight_kg === null ? null : targets.goal_weight_kg)

  const saveGoalWeight = async () => {
    const kg = typed === null ? null : weightFrom(typed, units)
    if (await onSaveProfile({ goal_weight_kg: kg })) markGoalSaved()
  }

  const pick = async (body: Record<string, unknown>) => {
    if (await onSaveProfile(body)) markPaceSaved()
  }

  const dismiss = async (key: string) => {
    await api(`/health/nudges/${key}/dismiss`, { method: 'POST' }).catch(() => undefined)
    onSaved()
  }

  const rate = targets.rate
  const gated = targets.goal === 'lose' && targets.rates_offered.length === 2
  const paceValue =
    targets.goal === 'maintain'
      ? 'Maintain'
      : [
          GOAL_LABEL[targets.goal],
          rate === null ? null : RATE_LABEL[rate],
          rate === null ? null : rateText(rate, units),
        ]
          .filter(Boolean)
          .join(' · ')

  const notes = notesFor(targets.note_keys, targets.notes, PACE_NOTES)
  const offer = targets.reestimate

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}

      <div className="mb-3 grid grid-cols-2 gap-3">
        <Tile
          label="Goal weight"
          value={
            targets.goal_weight_kg === null
              ? 'Add a goal weight'
              : weightText(targets.goal_weight_kg, units)
          }
          muted={targets.goal_weight_kg === null}
          onOpen={() => setOpen('goal')}
        />
        <div className="t-card">
          <p className="t-micro mb-1 flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" strokeWidth={2.5} />
            At this pace
          </p>
          <span
            className={`block text-lg font-semibold leading-tight ${
              targets.projection === null ? 'text-muted' : ''
            }`}
          >
            {targets.projection === null
              ? 'No date yet'
              : `About ${monthText(targets.projection.month)}`}
          </span>
        </div>
      </div>

      {targets.projection !== null && <p className="t-note mb-3">{PACE_CAVEAT}</p>}

      <div className="t-card mb-3">
        <Row
          label="Current weight"
          value={
            profile === null || profile.latest_weight_kg === null
              ? 'Add'
              : weightText(profile.latest_weight_kg, units)
          }
          onOpen={() => setOpen('weight')}
        />
        <Row
          label="Goal weight"
          value={
            targets.goal_weight_kg === null
              ? 'Not set'
              : weightText(targets.goal_weight_kg, units)
          }
          onOpen={() => setOpen('goal')}
        />
        <Row label="Goal and pace" value={paceValue} onOpen={() => setOpen('pace')} />
      </div>

      {notes.map((note) => (
        <p key={note} className="t-note mb-3">
          {note}
        </p>
      ))}

      {targets.nudges.map((nudge) => (
        <div key={nudge.key} className="t-card mb-3">
          <p className="text-sm">{nudge.text}</p>
          <button
            type="button"
            className="t-tap44 mt-2 text-sm text-muted"
            onClick={() => dismiss(nudge.key)}
          >
            Dismiss
          </button>
        </div>
      ))}

      {offer !== null && (
        <div className="t-card mb-3">
          <p className="text-sm">
            Your weight is moving differently from the pace you picked. tare can set your
            budget to {offer.calories} cal a day.
          </p>
          <button
            type="button"
            className="t-btn mt-3"
            disabled={busy}
            onClick={() =>
              void onSaveTargets({
                mode: 'grams',
                calories: offer.calories,
                protein_g: targets.budget.protein_g,
                carbs_g: targets.budget.carbs_g,
                fat_g: targets.budget.fat_g,
              })
            }
          >
            Use that instead
          </button>
        </div>
      )}

      <p className="t-note mb-3">
        <span className="block font-semibold">Good to know</span>
        {GOOD_TO_KNOW}
      </p>

      {open === 'weight' && (
        <MeasurementsSheet
          me={me}
          date={today(me.timezone)}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null)
            onSaved()
          }}
        />
      )}

      <Sheet open={open === 'goal'} label="Goal weight" onClose={() => setOpen(null)}>
        <p className="t-micro mb-2">Goal weight</p>
        <label className="t-label" htmlFor="goal-weight">
          Weight ({weightUnit(units)})
        </label>
        <input
          id="goal-weight"
          className="t-input"
          type="number"
          inputMode="decimal"
          step="0.1"
          value={goalWeight}
          onChange={(event) => setGoalWeight(event.target.value)}
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            className="t-btn t-btn-primary"
            disabled={busy || !goalDirty}
            onClick={() => void saveGoalWeight()}
          >
            Save
          </button>
          <SaveMarks dirty={goalDirty} saved={savedGoal} />
        </div>
        <p className="t-note mt-3">
          Leave it empty to have no goal weight. tare then shows no date.
        </p>
      </Sheet>

      <Sheet open={open === 'pace'} label="Goal and pace" onClose={() => setOpen(null)}>
        <p className="t-micro mb-2">Your goal</p>
        <div className="mb-4 flex gap-2">
          {GOALS.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={targets.goal === choice.value}
              disabled={busy}
              className="t-choice px-2 py-3 text-center"
              onClick={() => void pick({ goal: choice.value })}
            >
              <span className="block text-sm font-semibold">{choice.label}</span>
            </button>
          ))}
        </div>

        {targets.rates_offered.length > 0 && (
          <>
            <p className="t-micro mb-2">How fast</p>
            {targets.rates_offered.map((offered) => (
              <button
                key={offered}
                type="button"
                aria-pressed={rate === offered}
                disabled={busy}
                className="t-option"
                onClick={() => void pick({ rate: offered })}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{RATE_LABEL[offered]}</span>
                  <span className="block text-xs text-muted">{rateText(offered, units)}</span>
                </span>
                {rate === offered && (
                  <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.5} />
                )}
              </button>
            ))}
            {gated && (
              <p className="t-note mt-3">
                tare offers the two faster paces only when your details suggest they suit
                you.
              </p>
            )}
          </>
        )}

        <div className="mt-3 flex items-center gap-3">
          {busy ? (
            <span className="text-xs text-muted">Saving</span>
          ) : (
            <SaveMarks dirty={false} saved={savedPace} />
          )}
        </div>
      </Sheet>
    </>
  )
}
