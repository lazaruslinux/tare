import { ChevronRight, CircleCheck, Minus, Plus, Trophy } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { api, type Me, type Profile as ProfileRow, type Targets as TargetsRow } from '../api'
import { MeasurementsSheet } from '../components/MeasurementsSheet'
import { SaveMarks, useSavedChip } from '../components/SaveMarks'
import { ScaleGlyph } from '../components/ScaleGlyph'
import { Sheet } from '../components/Sheet'
import { today } from '../lib/day'
import {
  GOOD_TO_KNOW,
  PACE_CAVEAT,
  PACE_NOTES,
  asNumber,
  calText,
  monthText,
  notesFor,
  rateReview,
  rateStepText,
} from '../lib/targets'
import { weightFrom, weightIn, weightText, weightUnit } from '../lib/units'
import type { Save } from './Targets'

// Which sheet is open over the screen, if any.
type Open = 'weight' | 'goal' | null

// A tile in the overview: a glyph, the label under it, and the figure under
// that. The glyph is what makes the two read as a pair at a glance.
function Tile({
  glyph,
  label,
  value,
  muted,
}: {
  glyph: ReactNode
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="t-card">
      <span className="mb-1 block text-muted">{glyph}</span>
      <span className="t-micro mb-1 block">{label}</span>
      <span className={`block text-lg font-semibold leading-tight ${muted ? 'text-muted' : ''}`}>
        {value}
      </span>
    </div>
  )
}

// The same two-line row the Targets list uses: the value sits under its label,
// so a long one never squeezes the label.
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
  const [savedRate, markRateSaved] = useSavedChip()

  const typed = asNumber(goalWeight)
  const goalDirty =
    (typed === null ? null : weightFrom(typed, units)) !==
    (targets.goal_weight_kg === null ? null : targets.goal_weight_kg)

  const saveGoalWeight = async () => {
    const kg = typed === null ? null : weightFrom(typed, units)
    if (await onSaveProfile({ goal_weight_kg: kg })) markGoalSaved()
  }

  const dismiss = async (key: string) => {
    await api(`/health/nudges/${key}/dismiss`, { method: 'POST' }).catch(() => undefined)
    onSaved()
  }

  const steps = targets.rate_steps
  const rate = targets.rate_kg_per_week
  const at = rate === null ? 0 : Math.max(steps.indexOf(rate), 0)
  const latestKg = profile?.latest_weight_kg ?? null

  // The stepper only moves a draft; Save below the overview is what sends it.
  const [draftAt, setDraftAt] = useState(at)
  useEffect(() => setDraftAt(at), [at])
  const rateDirty = steps.length > 0 && draftAt !== at

  const step = (to: number) => {
    if (to < 0 || to >= steps.length) return
    setDraftAt(to)
  }

  const saveRate = async () => {
    if (await onSaveProfile({ rate_kg_per_week: steps[draftAt] })) markRateSaved()
  }

  const notes = notesFor(targets.note_keys, targets.notes, PACE_NOTES)
  const offer = targets.reestimate
  const adjustment = targets.breakdown === null ? null : Math.abs(targets.breakdown.adjustment)

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}

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
          label="Weight goal"
          value={
            targets.goal_weight_kg === null
              ? 'Not set'
              : weightText(targets.goal_weight_kg, units)
          }
          onOpen={() => setOpen('goal')}
        />
      </div>

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Set your goal rate</p>
        {steps.length === 0 || rate === null ? (
          <>
            <span className="block text-lg font-semibold leading-tight">Maintain</span>
            <p className="t-note mt-1">
              Set a weight goal above or below your current weight to pick a goal rate.
            </p>
          </>
        ) : (
          <>
            <div className="t-stepper">
              <button
                type="button"
                aria-label="Slower"
                disabled={busy || draftAt === 0}
                onClick={() => step(draftAt - 1)}
              >
                <Minus className="h-5 w-5" strokeWidth={2.5} />
              </button>
              <span className="t-nums flex-1 text-center text-base font-semibold">
                {rateStepText(steps[draftAt], units, targets.goal)}
              </span>
              <button
                type="button"
                aria-label="Faster"
                disabled={busy || draftAt === steps.length - 1}
                onClick={() => step(draftAt + 1)}
              >
                <Plus className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
            <div className="t-review mt-3">
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
              <span className="min-w-0">
                <span className="block font-semibold">Goal rate review</span>
                {rateReview(steps[draftAt], latestKg, targets.goal)}
              </span>
            </div>
          </>
        )}
      </div>

      <p className="t-micro mb-2">Goal overview</p>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Tile
          glyph={<ScaleGlyph className="h-5 w-5" />}
          label="Goal weight"
          value={
            targets.goal_weight_kg === null
              ? 'Not set'
              : weightText(targets.goal_weight_kg, units)
          }
          muted={targets.goal_weight_kg === null}
        />
        <Tile
          glyph={<Trophy className="h-5 w-5" strokeWidth={2} />}
          label="Goal forecast"
          value={
            targets.projection === null
              ? 'No date yet'
              : `About ${monthText(targets.projection.month)}`
          }
          muted={targets.projection === null}
        />
      </div>

      <div className="t-card mb-3">
        <span className="t-micro mb-1 block">Energy target</span>
        <span className="t-nums block text-lg font-semibold leading-tight">
          {calText(targets.budget.calories)} cal
        </span>
        {adjustment !== null && (
          <p className="t-note mt-1">
            {targets.goal === 'maintain' || adjustment === 0
              ? 'No deficit. Matches what you use.'
              : `${calText(adjustment)} cal daily ${
                  targets.goal === 'gain' ? 'surplus' : 'deficit'
                }`}
          </p>
        )}
      </div>

      {targets.projection !== null && <p className="t-note mb-3">{PACE_CAVEAT}</p>}

      {steps.length > 0 && (
        <div className="mb-3">
          <div className="t-actions">
            <button
              type="button"
              className="t-btn flex-1"
              disabled={busy || !rateDirty}
              onClick={() => setDraftAt(at)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="t-btn t-btn-primary flex-1"
              disabled={busy || !rateDirty}
              onClick={() => void saveRate()}
            >
              {busy ? 'Saving' : 'Save'}
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <SaveMarks dirty={rateDirty} saved={savedRate} />
          </div>
        </div>
      )}

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
            Your weight is moving differently from the goal rate you picked. Tare can set
            your budget to {offer.calories} cal a day.
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

      <Sheet open={open === 'goal'} label="Weight goal" onClose={() => setOpen(null)}>
        <p className="t-micro mb-2">Weight goal</p>
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
          A goal under your current weight is a losing plan and one above it is a gaining
          one. Leave it empty to have no weight goal. Tare then shows no date.
        </p>
      </Sheet>
    </>
  )
}
